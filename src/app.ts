import { App, LogLevel } from "@slack/bolt";
import { COMMAND, handleMeatproxyCommand } from "./command.js";
import type { Config } from "./config.js";
import { registerReactionTrigger } from "./reactionTrigger.js";
import { registerShortcut } from "./shortcut.js";

export interface CreateAppOptions {
  logLevel?: LogLevel;
  /**
   * Check the bot token with Slack (auth.test) as the app is built, so a bad
   * token fails at startup. Tests turn it off to build the app offline.
   */
  tokenVerificationEnabled?: boolean;
}

/**
 * Builds the Bolt app on an HTTP receiver and registers its handlers. Events,
 * interactivity and slash commands all arrive on the default `/slack/events`
 * endpoint, signed with `config.slackSigningSecret`. It does not start
 * listening: call `app.start()` for that.
 */
export function createApp(config: Config, options: CreateAppOptions = {}): App {
  const app = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    port: config.port,
    customRoutes: [
      {
        path: "/healthz",
        method: ["GET"],
        handler: (_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
        },
      },
    ],
    logLevel: options.logLevel ?? LogLevel.INFO,
    tokenVerificationEnabled: options.tokenVerificationEnabled ?? true,
  });
  registerHandlers(app, config);
  return app;
}

/**
 * Registers every trigger (reaction, message shortcut, slash command) on the
 * app.
 */
export function registerHandlers(app: App, config: Config): void {
  app.logger.debug(
    `registering handlers (trigger emoji :${config.triggerEmoji}:)`,
  );
  registerReactionTrigger(app, config);
  registerShortcut(app);
  app.command(COMMAND, (args) => handleMeatproxyCommand(args));
}
