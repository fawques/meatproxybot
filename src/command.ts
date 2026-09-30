import { callOut, type CallOutClient } from "./callOut.js";
import { feedbackText } from "./feedback.js";
import { parsePermalink } from "./permalink.js";

export const COMMAND = "/meatproxy";

export const USAGE_TEXT =
  "Right-click a message → Copy link, then `/meatproxy <link>`. " +
  "Or use the 🥩 message shortcut.";

export const INVALID_LINK_TEXT = "That doesn't look like a Slack message link.";

/** The slice of Bolt's slash command arguments that the handler uses. */
export interface CommandArgs {
  ack: () => Promise<void>;
  body: { text: string; user_id: string };
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
}

/**
 * Handles `/meatproxy <message link>`: calls out the linked message
 * anonymously. Every answer is an ephemeral response to the invoker, who
 * otherwise only appears in the audit log.
 */
export async function handleMeatproxyCommand(
  { ack, body, respond, context, client, logger }: CommandArgs,
  deps: CommandDeps = { callOut },
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
