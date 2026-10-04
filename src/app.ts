import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  App,
  LogLevel,
  ExpressReceiver,
  type Context,
  type Logger,
} from "@slack/bolt";
import { callOut } from "./callOut.js";
import { COMMAND, handleMeatproxyCommand } from "./command.js";
import type { Config } from "./config.js";
import { registerReactionTrigger } from "./reactionTrigger.js";
import { registerShortcut } from "./shortcut.js";
import { PostgresInstallationStore } from "./installationStore.js";
import type { UsageEvent } from "./usage.js";

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
/**
 * Holds the state's nonce in the browser that started the install, so a
 * callback only succeeds in that same browser (OAuth CSRF protection).
 */
export const STATE_COOKIE_NAME = "meatproxybot_oauth_state";
const OAUTH_SCOPES =
  "chat:write reactions:read reactions:write commands channels:history groups:history";

function generateSignedState(stateSecret: string): {
  state: string;
  nonce: string;
} {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const payload = `${nonce}.${timestamp}`;
  const signature = createHmac("sha256", stateSecret)
    .update(payload)
    .digest("hex");
  const state = Buffer.from(`${payload}.${signature}`).toString("base64url");
  return { state, nonce };
}

function validateSignedState(
  state: string,
  stateSecret: string,
): { valid: boolean; nonce?: string; error?: string } {
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

    return { valid: true, nonce };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Failed to validate state: ${errorMsg}` };
  }
}

function stateCookie(path: string, value: string, maxAge: number): string {
  return (
    `${STATE_COOKIE_NAME}=${value}; Max-Age=${String(maxAge)}; Path=${path}; ` +
    "HttpOnly; Secure; SameSite=Lax"
  );
}

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

function nonceMatches(cookieNonce: string | undefined, nonce: string): boolean {
  if (!cookieNonce) {
    return false;
  }
  const a = Buffer.from(cookieNonce);
  const b = Buffer.from(nonce);
  return a.length === b.length && timingSafeEqual(a, b);
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
      encryptionKey: config.encryptionKey ?? "",
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
    config.clientSecret &&
    config.publicBaseUrl
  ) {
    const stateSecret = config.stateSecret;
    const clientId = config.clientId;
    const clientSecret = config.clientSecret;
    const publicBaseUrl = config.publicBaseUrl;
    // Scope the state cookie to the bot's own path on a shared host.
    const cookiePath = new URL(publicBaseUrl).pathname || "/";

    receiver.router.get("/slack/install", (_req, res) => {
      const { state, nonce } = generateSignedState(stateSecret);
      const redirectUri = `${publicBaseUrl}/slack/oauth_redirect`;
      const url =
        `https://slack.com/oauth/v2/authorize?client_id=${clientId}&` +
        `scope=${encodeURIComponent(OAUTH_SCOPES)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${encodeURIComponent(state)}`;
      res.writeHead(302, {
        Location: url,
        "Set-Cookie": stateCookie(cookiePath, nonce, STATE_TIMEOUT_SECONDS),
      });
      res.end();
    });

    receiver.router.get("/slack/oauth_redirect", async (_req, res) => {
      const code = (_req.query as Record<string, unknown> | undefined)?.code as
        string | undefined;
      const stateParam = (_req.query as Record<string, unknown> | undefined)
        ?.state as string | undefined;
      const cookieNonce = readCookie(_req.headers.cookie, STATE_COOKIE_NAME);
      // The cookie is single-use: every callback response clears it.
      res.setHeader("Set-Cookie", stateCookie(cookiePath, "", 0));

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

      if (!nonceMatches(cookieNonce, stateValidation.nonce ?? "")) {
        app.logger.warn(
          "OAuth state validation failed: state does not match this browser",
        );
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "OAuth state validation failed: state does not match this browser. " +
            "Start the installation again from the same browser.",
        );
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
          const installation = {
            app_id: response.app_id,
            enterprise: undefined,
            team: { id: response.team.id },
            bot: {
              id: undefined,
              token: response.access_token,
              scopes: response.scope?.split(" ") ?? [],
            },
            bot_user_id: response.bot_user_id,
          };
          try {
            await store.save(installation);
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
  const isOAuthMode =
    config.clientId &&
    config.clientSecret &&
    config.stateSecret &&
    config.databaseUrl;

  // Every trigger records its callouts for the weekly usage stats, when
  // there is a database to record them in.
  // The store is looked up per callout: createApp replaces it on re-init.
  const recordUsage = isOAuthMode
    ? async (event: UsageEvent) => {
        await getGlobalInstallationStore()?.recordUsage(event);
      }
    : undefined;
  const callOutWithUsage: typeof callOut = (options) =>
    callOut({ ...options, recordUsage });

  registerReactionTrigger(app, config, callOutWithUsage);
  registerShortcut(app, { callOut: callOutWithUsage });
  app.command(COMMAND, (args) =>
    handleMeatproxyCommand(args, { callOut: callOutWithUsage }),
  );

  if (isOAuthMode) {
    // Slack puts team_id on the event envelope, not inside `event`; Bolt
    // copies it (and the enterprise) onto `context` for these two events.
    const deleteInstallation = async (
      context: Context,
      logger: Logger,
      reason: string,
    ): Promise<void> => {
      const store = getGlobalInstallationStore();
      const { teamId, enterpriseId, isEnterpriseInstall } = context;
      if (!store) {
        return;
      }
      if (!teamId) {
        logger.warn(`Cannot delete installation on ${reason}: no team id`);
        return;
      }
      try {
        await store.delete({
          teamId,
          isEnterpriseInstall,
          ...(enterpriseId ? { enterpriseId } : {}),
        });
        logger.info(`Deleted installation for team ${teamId} on ${reason}`);
      } catch (err) {
        logger.error(`Error deleting installation for team ${teamId}:`, err);
      }
    };

    app.event("app_uninstalled", async ({ context, logger }) => {
      await deleteInstallation(context, logger, "uninstall");
    });

    app.event("tokens_revoked", async ({ event, context, logger }) => {
      // Revoking only user tokens leaves the bot installed.
      if (!event.tokens.bot?.length) {
        return;
      }
      await deleteInstallation(context, logger, "bot token revocation");
    });
  }
}
