import { App, LogLevel } from "@slack/bolt";
import { COMMAND, handleMeatproxyCommand } from "./command.js";
import type { Config } from "./config.js";

export interface CreateAppOptions {
  logLevel?: LogLevel;
  /**
   * Check the bot token with Slack (auth.test) as the app is built, so a bad
   * token fails at startup. Tests turn it off to build the app offline.
   */
  tokenVerificationEnabled?: boolean;
}

/**
 * Builds the Bolt app in Socket Mode and registers its handlers.
 * It does not open the Socket Mode connection: call `app.start()` for that.
 */
export function createApp(config: Config, options: CreateAppOptions = {}): App {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
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
  app.command(COMMAND, (args) => handleMeatproxyCommand(args));
}
