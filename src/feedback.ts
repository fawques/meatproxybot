import type { CallOutResult } from "./callOut.js";

/**
 * The ephemeral message telling the invoker how their callout went. Shared by
 * the anonymous triggers (message shortcut and slash command).
 */
export function feedbackText(result: CallOutResult): string {
  switch (result.status) {
    case "posted":
      return "🥩 Called out. Nobody knows it was you.";
    case "already":
      return "Already called out, it's on the record.";
    case "error":
      switch (result.reason) {
        case "dm":
          return "I only work in channels, not DMs.";
        case "own_message":
          return "Nice try, I'm not calling myself out.";
        case "not_in_channel":
          return "Invite me to this channel first (`/invite @meatproxybot`).";
        default:
          return "Couldn't call that out, sorry.";
      }
  }
}
