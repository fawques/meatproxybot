import { createHmac, randomBytes } from "node:crypto";
import { App, LogLevel, ExpressReceiver } from "@slack/bolt";
import { COMMAND, handleMeatproxyCommand } from "./command.js";
import type { Config } from "./config.js";
import { registerReactionTrigger } from "./reactionTrigger.js";
import { registerShortcut } from "./shortcut.js";
import { PostgresInstallationStore } from "./installationStore.js";

export interface CreateAppOptions {
  logLevel?: LogLevel;
  /**
   * Check the bot token with Slack (auth.test) as the app is built, so a bad
   * token fails at startup. Tests turn it off to build the app offline.
   */
  tokenVerificationEnabled?: boolean;
}

let globalInstallationStore: PostgresInstallationStore | undefined;

const STATE_TIMEOUT_SECONDS = 600;

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
    globalInstallationStore = new PostgresInstallationStore({
      databaseUrl: config.databaseUrl,
      schema: config.databaseSchema,
    });
    await globalInstallationStore.init();
  }

  const app = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    port: config.port,
    receiver,
    clientId: isOAuthMode ? config.clientId : undefined,
    clientSecret: isOAuthMode ? config.clientSecret : undefined,
    stateSecret: isOAuthMode ? config.stateSecret : undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
    installationStore: globalInstallationStore as any,
    logLevel: options.logLevel ?? LogLevel.INFO,
    tokenVerificationEnabled: options.tokenVerificationEnabled ?? true,
  });

  if (
    isOAuthMode &&
    config.stateSecret &&
    config.clientId &&
    config.clientSecret
  ) {
    const stateSecret = config.stateSecret;
    const clientId = config.clientId;
    const clientSecret = config.clientSecret;

    receiver.router.get("/slack/install", (_req, res) => {
      const state = generateSignedState(stateSecret);
      const url =
        `https://slack.com/oauth/v2/authorize?client_id=${clientId}&` +
        `scope=chat:write,reactions:read,reactions:write,commands,channels:history,groups:history&` +
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
        const response = await app.client.oauth.v2.access({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        });

        if (response.ok && response.team?.id) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Installation successful!</h1>" +
              "<p>You can close this window.</p></body></html>",
          );
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

export function getGlobalInstallationStore():
  PostgresInstallationStore | undefined {
  return globalInstallationStore;
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
          await store.delete({
            teamId,
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
          await store.delete({
            teamId,
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
