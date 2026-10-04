import { createHmac, randomBytes } from "node:crypto";
import {
  App,
  LogLevel,
  ExpressReceiver,
  type Authorize,
  type AuthorizeResult,
  type Installation,
} from "@slack/bolt";
import { COMMAND, handleMeatproxyCommand } from "./command.js";
import type { Config } from "./config.js";
import { registerReactionTrigger } from "./reactionTrigger.js";
import { registerShortcut } from "./shortcut.js";
import { PostgresInstallationStore } from "./installationStore.js";
import { scheduleNightlyBackup } from "./backup.js";

export interface CreateAppOptions {
  logLevel?: LogLevel;
  /**
   * Check the bot token with Slack (auth.test) as the app is built, so a bad
   * token fails at startup. Tests turn it off to build the app offline.
   */
  tokenVerificationEnabled?: boolean;
}

let globalInstallationStore: PostgresInstallationStore | undefined;
let globalBackupCleanup: (() => void) | undefined;

const STATE_TIMEOUT_SECONDS = 600;
const OAUTH_SCOPES =
  "chat:write reactions:read reactions:write commands channels:history groups:history";

function generateSignedState(stateSecret: string): string {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const payload = `${nonce}.${timestamp}`;
  const signature = createHmac("sha256", stateSecret)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

function validateSignedState(
  state: string,
  stateSecret: string,
): { valid: boolean; error?: string } {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid state format" };
    }

    const nonce = parts[0];
    const timestamp = parts[1];
    const signature = parts[2];
    if (!nonce || !timestamp || !signature) {
      return { valid: false, error: "Invalid state format" };
    }
    const payload = `${nonce}.${timestamp}`;

    const expectedSignature = createHmac("sha256", stateSecret)
      .update(payload)
      .digest("hex");

    if (signature !== expectedSignature) {
      return { valid: false, error: "Invalid state signature" };
    }

    const stateTime = parseInt(timestamp, 10);
    if (!Number.isInteger(stateTime)) {
      return { valid: false, error: "Invalid state timestamp format" };
    }
    const now = Date.now();
    if (now - stateTime > STATE_TIMEOUT_SECONDS * 1000) {
      return { valid: false, error: "State expired" };
    }

    return { valid: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Failed to validate state: ${errorMsg}` };
  }
}

/**
 * Builds the Bolt app on an HTTP receiver and registers its handlers. Events,
 * interactivity and slash commands all arrive on the default `/slack/events`
 * endpoint, signed with `config.slackSigningSecret`. It does not start
 * listening: call `app.start()` for that.
 */
export async function createApp(
  config: Config,
  options: CreateAppOptions = {},
): Promise<App> {
  const isOAuthMode =
    config.clientId &&
    config.clientSecret &&
    config.stateSecret &&
    config.databaseUrl;

  const receiver = new ExpressReceiver({
    signingSecret: config.slackSigningSecret,
  });

  if (isOAuthMode && config.databaseUrl) {
    if (globalInstallationStore) {
      await globalInstallationStore.close();
    }
    globalInstallationStore = new PostgresInstallationStore({
      databaseUrl: config.databaseUrl,
      schema: config.databaseSchema,
    });
    await globalInstallationStore.init();
  }

  // Bolt ignores its own OAuth options (clientId, installationStore, ...)
  // when given a custom receiver, so OAuth mode passes an explicit authorize
  // that looks up each workspace's bot token. SLACK_BOT_TOKEN is not used
  // then: it would authorize every workspace with one workspace's token.
  const app = new App({
    ...(globalInstallationStore
      ? { authorize: authorizeFromStore(globalInstallationStore) }
      : { token: config.slackBotToken }),
    signingSecret: config.slackSigningSecret,
    port: config.port,
    receiver,
    logLevel: options.logLevel ?? LogLevel.INFO,
    tokenVerificationEnabled: options.tokenVerificationEnabled ?? true,
  });

  if (
    isOAuthMode &&
    config.stateSecret &&
    config.clientId &&
    config.clientSecret &&
    config.publicBaseUrl
  ) {
    const stateSecret = config.stateSecret;
    const clientId = config.clientId;
    const clientSecret = config.clientSecret;
    const publicBaseUrl = config.publicBaseUrl;

    receiver.router.get("/slack/install", (_req, res) => {
      const state = generateSignedState(stateSecret);
      const redirectUri = `${publicBaseUrl}/slack/oauth_redirect`;
      const url =
        `https://slack.com/oauth/v2/authorize?client_id=${clientId}&` +
        `scope=${encodeURIComponent(OAUTH_SCOPES)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${encodeURIComponent(state)}`;
      res.writeHead(302, { Location: url });
      res.end();
    });

    receiver.router.get("/slack/oauth_redirect", async (_req, res) => {
      const code = (_req.query as Record<string, unknown> | undefined)?.code as
        string | undefined;
      const stateParam = (_req.query as Record<string, unknown> | undefined)
        ?.state as string | undefined;

      if (!code || !stateParam) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing code or state parameter");
        return;
      }

      const stateValidation = validateSignedState(stateParam, stateSecret);
      if (!stateValidation.valid) {
        const errorMsg = stateValidation.error ?? "Unknown error";
        app.logger.warn(`OAuth state validation failed: ${errorMsg}`);
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`OAuth state validation failed: ${errorMsg}`);
        return;
      }

      try {
        const redirectUri = `${publicBaseUrl}/slack/oauth_redirect`;
        const response = await app.client.oauth.v2.access({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        });

        if (response.ok && response.team?.id && response.bot_user_id) {
          const store = getGlobalInstallationStore();
          if (!store) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Installation store not configured");
            return;
          }
          if (!response.access_token) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("OAuth exchange failed");
            return;
          }
          const installation: Installation<"v2", false> = {
            team: { id: response.team.id },
            enterprise: undefined,
            user: {
              token: undefined,
              scopes: undefined,
              id: response.authed_user?.id ?? "",
            },
            bot: {
              token: response.access_token,
              scopes: response.scope?.split(" ") ?? [],
              id: "",
              userId: response.bot_user_id,
            },
            ...(response.app_id ? { appId: response.app_id } : {}),
            tokenType: "bot",
            isEnterpriseInstall: false,
            authVersion: "v2",
          };
          try {
            await store.storeInstallation(installation);
            app.logger.info(`Saved installation for team ${response.team.id}`);
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(
              "<html><body><h1>Installation successful!</h1>" +
                "<p>You can close this window.</p></body></html>",
            );
          } catch (saveErr) {
            const errorMsg =
              saveErr instanceof Error ? saveErr.message : String(saveErr);
            app.logger.error(
              `Failed to save installation for team ${response.team.id}: ${errorMsg}`,
            );
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Failed to save installation");
            return;
          }
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("OAuth exchange failed");
        }
      } catch (err) {
        app.logger.error("OAuth exchange error:", err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal server error");
      }
    });
  }

  receiver.router.get("/healthz", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });

  registerHandlers(app, config);

  return app;
}

/**
 * Builds Bolt's authorize from the installation store: each event gets the
 * bot token of the workspace it came from. It throws for a workspace with no
 * installation, so Bolt drops the event.
 */
export function authorizeFromStore(
  store: PostgresInstallationStore,
): Authorize<boolean> {
  return async (source) => {
    const installation = await store.fetchInstallation(source);
    const { bot } = installation;
    const result: AuthorizeResult = { teamId: installation.team.id };
    const enterpriseId = installation.enterprise?.id ?? source.enterpriseId;
    if (enterpriseId) result.enterpriseId = enterpriseId;
    if (bot?.token) result.botToken = bot.token;
    if (bot?.id) result.botId = bot.id;
    if (bot?.userId) result.botUserId = bot.userId;
    return result;
  };
}

export function getGlobalInstallationStore():
  PostgresInstallationStore | undefined {
  return globalInstallationStore;
}

/**
 * Starts the nightly backup scheduler if a database path is configured.
 * Returns a cleanup function to stop the scheduler.
 */
export function startBackupScheduler(
  config: Config,
  logger: (
    level: string,
    msg: string,
    fields?: Record<string, unknown>,
  ) => void,
): (() => void) | null {
  if (!config.installationDbPath) {
    return null;
  }

  const backupDir = config.installationDbPath.replace(/[^/]*$/, "backups");
  globalBackupCleanup = scheduleNightlyBackup(
    {
      dbPath: config.installationDbPath,
      backupDir,
      maxBackups: 7,
    },
    logger,
  );

  return globalBackupCleanup;
}

export function getBackupCleanup(): (() => void) | undefined {
  return globalBackupCleanup;
}

/**
 * Registers every trigger (reaction, message shortcut, slash command) on the
 * app, plus OAuth cleanup handlers.
 */
export function registerHandlers(app: App, config: Config): void {
  app.logger.debug(
    `registering handlers (trigger emoji :${config.triggerEmoji}:)`,
  );
  registerReactionTrigger(app, config);
  registerShortcut(app);
  app.command(COMMAND, (args) => handleMeatproxyCommand(args));

  const isOAuthMode =
    config.clientId &&
    config.clientSecret &&
    config.stateSecret &&
    config.databaseUrl;
  if (isOAuthMode) {
    app.event("app_uninstalled", async ({ event, logger }) => {
      const store = getGlobalInstallationStore();
      const teamId = (event as unknown as Record<string, unknown>).team_id;
      if (store && teamId && typeof teamId === "string") {
        try {
          await store.deleteInstallation({
            teamId,
            enterpriseId: undefined,
            isEnterpriseInstall: false,
          });
          logger.info(`Deleted installation for team ${teamId}`);
        } catch (err) {
          logger.error(`Error deleting installation for team ${teamId}:`, err);
        }
      }
    });

    app.event("tokens_revoked", async ({ event, logger }) => {
      const store = getGlobalInstallationStore();
      const teamId = (event as unknown as Record<string, unknown>).team_id;
      if (store && teamId && typeof teamId === "string") {
        try {
          await store.deleteInstallation({
            teamId,
            enterpriseId: undefined,
            isEnterpriseInstall: false,
          });
          logger.info(
            `Deleted installation for team ${teamId} due to token revocation`,
          );
        } catch (err) {
          logger.error(`Error deleting installation for team ${teamId}:`, err);
        }
      }
    });
  }
}
