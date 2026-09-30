import type { App, webApi } from "@slack/bolt";
import { callOut as defaultCallOut, type CallOutResult } from "./callOut.js";
import { feedbackText } from "./feedback.js";

/** The message shortcut's callback_id, declared in manifest.yml. */
export const SHORTCUT_CALLBACK_ID = "call_out_meat_proxy";

export interface RegisterShortcutOptions {
  /** The callout service, injectable for tests. */
  callOut?: typeof defaultCallOut;
}

/**
 * Registers the "🥩 Call out meat proxy" message shortcut. It is anonymous:
 * the invoker only gets ephemeral feedback, always, and is only named in the
 * callOut audit log.
 */
export function registerShortcut(
  app: App,
  options: RegisterShortcutOptions = {},
): void {
  const callOut = options.callOut ?? defaultCallOut;

  app.shortcut(
    SHORTCUT_CALLBACK_ID,
    async ({ shortcut, ack, client, context, logger }) => {
      // Ack first: Slack drops the shortcut if it isn't acked within 3s.
      await ack();
      if (shortcut.type !== "message_action") return;

      const channel = shortcut.channel.id;
      const invoker = shortcut.user.id;
      const threadTs: unknown = shortcut.message.thread_ts;

      let result: CallOutResult;
      if (context.botUserId === undefined) {
        logger.error("shortcut: bot user id unknown, cannot call out");
        result = { status: "error", reason: "unknown" };
      } else {
        result = await callOut({
          client,
          botUserId: context.botUserId,
          target: {
            channel,
            ts: shortcut.message.ts,
            threadTs: typeof threadTs === "string" ? threadTs : undefined,
          },
          invoker,
          trigger: "shortcut",
        });
      }

      await postFeedback(client, logger, {
        channel,
        user: invoker,
        text: feedbackText(result),
        ...(typeof threadTs === "string" ? { thread_ts: threadTs } : {}),
      });
    },
  );
}

/**
 * Sends the invoker their ephemeral feedback. A failure (e.g. the bot is not
 * in the channel) is logged, not thrown: there is nowhere else to report it.
 */
async function postFeedback(
  client: webApi.WebClient,
  logger: App["logger"],
  args: { channel: string; user: string; text: string; thread_ts?: string },
): Promise<void> {
  try {
    await client.chat.postEphemeral(args);
  } catch (err) {
    logger.error(
      `shortcut: postEphemeral failed in ${args.channel}: ${String(err)}`,
    );
  }
}
