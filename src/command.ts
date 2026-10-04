import { callOut, type CallOutClient } from "./callOut.js";
import { parseEmojiName, type Config } from "./config.js";
import { feedbackText } from "./feedback.js";
import { parsePermalink } from "./permalink.js";

export const COMMAND = "/meatproxy";

export const USAGE_TEXT =
  "Right-click a message → Copy link, then `/meatproxy <link>`. " +
  "Or use the 🥩 message shortcut.\n" +
  "`/meatproxy emoji` shows the reaction trigger emoji, " +
  "`/meatproxy emoji <name>` changes it for this workspace and " +
  "`/meatproxy emoji reset` goes back to the default.";

export const INVALID_LINK_TEXT = "That doesn't look like a Slack message link.";

export const EMOJI_UNAVAILABLE_TEXT =
  "This bot has no database, so the trigger emoji can't be changed per " +
  "workspace. Its operator can change it for every workspace with " +
  "`TRIGGER_EMOJI`.";

export const EMOJI_STORE_FAILED_TEXT =
  "Couldn't read or save the trigger emoji, sorry. Try again later.";

export function invalidEmojiText(name: string): string {
  return (
    `\`${name}\` isn't an emoji name. Names use lowercase letters, ` +
    "digits, `_`, `-`, `+` and `'`, like `robot_face` or `:robot_face:`."
  );
}

export function currentEmojiText(
  emoji: string,
  source: "workspace" | "default",
): string {
  return source === "workspace"
    ? `The trigger emoji in this workspace is :${emoji}: (set with \`/meatproxy emoji\`).`
    : `The trigger emoji in this workspace is :${emoji}:, the default. ` +
        "Change it with `/meatproxy emoji <name>`.";
}

const EXISTS_REMINDER =
  "The reaction trigger only works if that emoji exists in this workspace.";

export function emojiSetText(emoji: string): string {
  return (
    `Reacting with :${emoji}: now calls out a message in this workspace. ` +
    EXISTS_REMINDER
  );
}

export function emojiResetText(emoji: string): string {
  return (
    `The trigger emoji is back to the default, :${emoji}:. ` + EXISTS_REMINDER
  );
}

/** The slice of Bolt's slash command arguments that the handler uses. */
export interface CommandArgs {
  ack: () => Promise<void>;
  body: { text: string; user_id: string; team_id: string };
  respond: (message: {
    response_type: "ephemeral";
    text: string;
  }) => Promise<unknown>;
  context: { botUserId?: string | undefined };
  client: CallOutClient;
  logger: { error: (...msg: unknown[]) => void };
}

export interface CommandDeps {
  /** The callout service, injectable for tests. */
  callOut: typeof callOut;
  /** The default trigger emoji and the per-workspace settings, if any. */
  config: Pick<Config, "triggerEmoji" | "workspaceStore">;
}

/**
 * Handles `/meatproxy <message link>`: calls out the linked message
 * anonymously. Every answer is an ephemeral response to the invoker, who
 * otherwise only appears in the audit log. `/meatproxy emoji ...` shows or
 * changes the workspace's reaction trigger emoji instead.
 */
export async function handleMeatproxyCommand(
  { ack, body, respond, context, client, logger }: CommandArgs,
  deps: CommandDeps,
): Promise<void> {
  // Slack wants the ack within 3 seconds; callOut makes several API calls.
  await ack();

  const reply = async (text: string): Promise<void> => {
    try {
      await respond({ response_type: "ephemeral", text });
    } catch (err) {
      logger.error("failed to respond to /meatproxy", err);
    }
  };

  const text = body.text.trim();
  if (text === "" || text.toLowerCase() === "help") {
    await reply(USAGE_TEXT);
    return;
  }
  const [subcommand, ...args] = text.split(/\s+/);
  if (subcommand?.toLowerCase() === "emoji") {
    await reply(await handleEmoji(args.join(" "), body.team_id, deps, logger));
    return;
  }
  const target = parsePermalink(text);
  if (!target) {
    await reply(INVALID_LINK_TEXT);
    return;
  }
  if (!context.botUserId) {
    logger.error("/meatproxy: bot user id unknown, cannot call out");
    await reply(feedbackText({ status: "error", reason: "unknown" }));
    return;
  }

  const result = await deps.callOut({
    client,
    botUserId: context.botUserId,
    target,
    invoker: body.user_id,
    trigger: "command",
  });
  await reply(feedbackText(result));
}

/**
 * `/meatproxy emoji [<name>|reset]`: shows, sets or resets the workspace's
 * trigger emoji, and returns the reply. Anyone in the workspace may change
 * it. Whether a custom emoji exists is not checked: that would need the
 * `emoji:read` scope.
 */
async function handleEmoji(
  arg: string,
  teamId: string,
  { config }: CommandDeps,
  logger: CommandArgs["logger"],
): Promise<string> {
  const store = config.workspaceStore;
  try {
    if (arg === "") {
      const emoji = await store?.getTriggerEmoji(teamId);
      return emoji
        ? currentEmojiText(emoji, "workspace")
        : currentEmojiText(config.triggerEmoji, "default");
    }
    if (!store) {
      return EMOJI_UNAVAILABLE_TEXT;
    }
    if (arg.toLowerCase() === "reset") {
      await store.clearTriggerEmoji(teamId);
      return emojiResetText(config.triggerEmoji);
    }
    const emoji = parseEmojiName(arg);
    if (!emoji) {
      return invalidEmojiText(arg);
    }
    await store.setTriggerEmoji(teamId, emoji);
    return emojiSetText(emoji);
  } catch (err) {
    logger.error(`/meatproxy emoji failed for team ${teamId}`, err);
    return EMOJI_STORE_FAILED_TEXT;
  }
}
