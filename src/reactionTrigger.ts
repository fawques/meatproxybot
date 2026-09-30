import type { App } from "@slack/bolt";
import { callOut } from "./callOut.js";
import type { Config } from "./config.js";

/**
 * Registers the public trigger: reacting to a message with the trigger emoji
 * calls it out. Slack shows who reacted, so this path is not anonymous. The
 * reactor gets no feedback; errors are only logged. Removing the reaction
 * does nothing. `callOutFn` is injectable for tests.
 */
export function registerReactionTrigger(
  app: App,
  config: Config,
  callOutFn: typeof callOut = callOut,
): void {
  app.event("reaction_added", async ({ event, context, client, logger }) => {
    if (event.reaction !== config.triggerEmoji) return;
    // Bolt types the item as a message, but Slack also sends reactions on
    // files and file comments.
    const itemType: string = event.item.type;
    if (itemType !== "message") return;
    const { botUserId } = context;
    // The bot's own :meat_proxy: fires reaction_added too; it must not loop.
    if (botUserId === undefined || event.user === botUserId) return;

    const target = { channel: event.item.channel, ts: event.item.ts };
    try {
      const result = await callOutFn({
        client,
        botUserId,
        target,
        invoker: event.user,
        trigger: "reaction",
      });
      if (result.status === "error") {
        logger.warn(
          `reaction callout failed (${result.reason}) on ${target.channel}/${target.ts}`,
        );
      }
    } catch (err) {
      logger.warn(
        `reaction callout threw on ${target.channel}/${target.ts}: ${String(err)}`,
      );
    }
  });
}
