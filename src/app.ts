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

  if (isOAuthMode) {
    receiver.router.get("/slack/install", (_req, res) => {
      const state = Math.random().toString(36).substring(2, 15);
      const clientId = config.clientId;
      if (!clientId) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Client ID not configured");
        return;
      }
      const url =
        `https://slack.com/oauth/v2/authorize?client_id=${clientId}&` +
        `scope=chat:write,reactions:read,reactions:write,commands,channels:history,groups:history&` +
        `state=${state}`;
      res.writeHead(302, { Location: url });
      res.end();
    });

    receiver.router.get("/slack/oauth_redirect", async (_req, res) => {
      const code = (_req.query as Record<string, unknown> | undefined)?.code as
        string | undefined;
      const state = (_req.query as Record<string, unknown> | undefined)
        ?.state as string | undefined;

      if (!code || !state) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing code or state parameter");
        return;
      }

      try {
        const response = await app.client.oauth.v2.access({
          client_id: config.clientId ?? "",
          client_secret: config.clientSecret ?? "",
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
      const teamId = (event as unknown as Record<string, unknown>).team;
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
      const teamId = (event as unknown as Record<string, unknown>).team;
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
