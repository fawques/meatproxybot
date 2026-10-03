export interface Config {
  slackBotToken?: string;
  slackSigningSecret: string;
  port: number;
  triggerEmoji: string;
  clientId?: string;
  clientSecret?: string;
  stateSecret?: string;
  databaseUrl?: string;
  databaseSchema: string;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const DEFAULT_TRIGGER_EMOJI = "meat_proxy";
const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_SCHEMA = "meatproxybot_prod";

/**
 * Reads and validates the bot's configuration from the environment.
 * Throws a ConfigError listing every problem, so a misconfigured bot fails
 * fast with a clear message instead of failing on its first Slack call.
 *
 * OAuth mode requires CLIENT_ID, CLIENT_SECRET, STATE_SECRET, and DATABASE_URL.
 * Legacy mode requires SLACK_BOT_TOKEN.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const slackSigningSecret = env.SLACK_SIGNING_SECRET?.trim() || "";
  if (!slackSigningSecret) {
    problems.push("SLACK_SIGNING_SECRET is missing");
  }

  const port = parsePort(env.PORT, problems);

  const triggerEmoji = (
    env.TRIGGER_EMOJI?.trim() || DEFAULT_TRIGGER_EMOJI
  ).replace(/^:|:$/g, "");
  if (!/^[a-z0-9_+'-]+$/.test(triggerEmoji)) {
    problems.push(
      `TRIGGER_EMOJI must be an emoji name such as "${DEFAULT_TRIGGER_EMOJI}", got "${triggerEmoji}"`,
    );
  }

  const clientId = env.SLACK_CLIENT_ID?.trim();
  const clientSecret = env.SLACK_CLIENT_SECRET?.trim();
  const stateSecret = env.SLACK_STATE_SECRET?.trim();
  const databaseUrl = env.DATABASE_URL?.trim();
  const databaseSchema = env.DATABASE_SCHEMA?.trim() || DEFAULT_DATABASE_SCHEMA;

  const isOAuthMode = !!(
    clientId &&
    clientSecret &&
    stateSecret &&
    databaseUrl
  );
  const isLegacyMode = !!env.SLACK_BOT_TOKEN?.trim();

  if (!isOAuthMode && !isLegacyMode) {
    problems.push(
      "Either OAuth mode (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_STATE_SECRET, DATABASE_URL) or legacy mode (SLACK_BOT_TOKEN) must be configured",
    );
  }

  if (isOAuthMode && !clientId) {
    problems.push("SLACK_CLIENT_ID is required for OAuth mode");
  }
  if (isOAuthMode && !clientSecret) {
    problems.push("SLACK_CLIENT_SECRET is required for OAuth mode");
  }
  if (isOAuthMode && !stateSecret) {
    problems.push("SLACK_STATE_SECRET is required for OAuth mode");
  }
  if (isOAuthMode && !databaseUrl) {
    problems.push("DATABASE_URL is required for OAuth mode");
  }

  if (problems.length > 0) {
    throw new ConfigError(
      `Invalid configuration:\n  - ${problems.join("\n  - ")}`,
    );
  }

  const slackBotToken = env.SLACK_BOT_TOKEN?.trim();
  const config: Config = {
    slackSigningSecret,
    port,
    triggerEmoji,
    databaseSchema,
  };

  if (slackBotToken) {
    config.slackBotToken = slackBotToken;
  }
  if (isOAuthMode) {
    config.clientId = clientId;
    config.clientSecret = clientSecret;
    config.stateSecret = stateSecret;
    config.databaseUrl = databaseUrl;
  }

  return config;
}

function parsePort(value: string | undefined, problems: string[]): number {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_PORT;
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be an integer from 1 to 65535, got "${trimmed}"`);
    return DEFAULT_PORT;
  }
  return port;
}
