import { describe, expect, it } from "vitest";
import type { CallOutResult } from "../src/callOut.js";
import { feedbackText } from "../src/feedback.js";

describe("feedbackText", () => {
  it.each<[CallOutResult, string]>([
    [{ status: "posted" }, "🥩 Called out. Nobody knows it was you."],
    [{ status: "already" }, "Already called out, it's on the record."],
    [{ status: "error", reason: "dm" }, "I only work in channels, not DMs."],
    [
      { status: "error", reason: "own_message" },
      "Nice try, I'm not calling myself out.",
    ],
    [
      { status: "error", reason: "not_in_channel" },
      "Invite me to this channel first (`/invite @meatproxybot`).",
    ],
    [
      { status: "error", reason: "not_found" },
      "Couldn't call that out, sorry.",
    ],
    [{ status: "error", reason: "unknown" }, "Couldn't call that out, sorry."],
  ])("maps %j", (result, text) => {
    expect(feedbackText(result)).toBe(text);
  });
});
