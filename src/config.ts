import type { WorkspaceStore } from "./workspaceStore.js";

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  triggerEmoji: string;
  workspaceStore?: WorkspaceStore;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const DEFAULT_TRIGGER_EMOJI = "meat_proxy";

/**
 * Reads and validates the bot's configuration from the environment.
 * Throws a ConfigError listing every problem, so a misconfigured bot fails
 * fast with a clear message instead of failing on its first Slack call.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const slackBotToken = requirePrefixed(
    env,
    "SLACK_BOT_TOKEN",
    "xoxb-",
    problems,
  );
  const slackAppToken = requirePrefixed(
    env,
    "SLACK_APP_TOKEN",
    "xapp-",
    problems,
  );

  const triggerEmoji = (
    env.TRIGGER_EMOJI?.trim() || DEFAULT_TRIGGER_EMOJI
  ).replace(/^:|:$/g, "");
  if (!/^[a-z0-9_+'-]+$/.test(triggerEmoji)) {
    problems.push(
      `TRIGGER_EMOJI must be an emoji name such as "${DEFAULT_TRIGGER_EMOJI}", got "${triggerEmoji}"`,
    );
  }

  if (problems.length > 0) {
    throw new ConfigError(
      `Invalid configuration:\n  - ${problems.join("\n  - ")}`,
    );
  }

  return { slackBotToken, slackAppToken, triggerEmoji };
}

/**
 * Get the effective trigger emoji for a workspace.
 * First looks up workspace-specific configuration, then falls back to the
 * global default.
 */
export function getTriggerEmojiForWorkspace(
  config: Config,
  teamId: string,
): string {
  if (config.workspaceStore) {
    const workspaceEmoji = config.workspaceStore.getTriggerEmoji(teamId);
    if (workspaceEmoji) {
      return workspaceEmoji;
    }
  }
  return config.triggerEmoji;
}

function requirePrefixed(
  env: NodeJS.ProcessEnv,
  name: string,
  prefix: string,
  problems: string[],
): string {
  const value = env[name]?.trim();
  if (!value) {
    problems.push(
      `${name} is missing (expected a token starting with "${prefix}")`,
    );
    return "";
  }
  if (!value.startsWith(prefix)) {
    problems.push(`${name} must start with "${prefix}"`);
  }
  return value;
}
