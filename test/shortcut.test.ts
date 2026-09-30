import type { App } from "@slack/bolt";
import { describe, expect, it, vi } from "vitest";
import type { CallOutOptions, CallOutResult } from "../src/callOut.js";
import { feedbackText } from "../src/feedback.js";
import { registerShortcut, SHORTCUT_CALLBACK_ID } from "../src/shortcut.js";

const BOT = "UBOT";
const INVOKER = "UINVOKER";
const CHANNEL = "C123";
const TS = "1700000000.000100";
const PARENT_TS = "1700000000.000001";

type Handler = (args: Record<string, unknown>) => Promise<void>;

/** Registers the shortcut on a fake app and returns the captured handler. */
function setup(result: CallOutResult | (() => Promise<CallOutResult>)) {
  const calls: string[] = [];
  const shortcut = vi.fn();
  const app = { shortcut } as unknown as App;
  const callOut = vi.fn<(options: CallOutOptions) => Promise<CallOutResult>>(
    async () => {
      calls.push("callOut:start");
      const r = typeof result === "function" ? await result() : result;
      calls.push("callOut:end");
      return r;
    },
  );
  registerShortcut(app, { callOut });
  expect(shortcut).toHaveBeenCalledWith(
    SHORTCUT_CALLBACK_ID,
    expect.any(Function),
  );
  const handler = shortcut.mock.calls[0]?.[1] as Handler;

  const ack = vi.fn(() => {
    calls.push("ack");
    return Promise.resolve();
  });
  const client = {
    chat: {
      postEphemeral: vi.fn(() => {
        calls.push("chat.postEphemeral");
        return Promise.resolve({ ok: true });
      }),
      postMessage: vi.fn(() => Promise.resolve({ ok: true })),
    },
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { handler, callOut, ack, client, logger, calls };
}

function payload(message: Record<string, unknown> = {}) {
  return {
    type: "message_action",
    callback_id: SHORTCUT_CALLBACK_ID,
    trigger_id: "trigger",
    message_ts: TS,
    response_url: "https://hooks.slack.test/response",
    message: { type: "message", user: "UPOSTER", ts: TS, ...message },
    user: { id: INVOKER, name: "invoker" },
    channel: { id: CHANNEL, name: "general" },
    team: { id: "T1", domain: "test" },
    token: "token",
    action_ts: "1700000001.000000",
  };
}

async function invoke(
  s: ReturnType<typeof setup>,
  body = payload(),
  context: Record<string, unknown> = { botUserId: BOT },
) {
  await s.handler({
    shortcut: body,
    body,
    ack: s.ack,
    client: s.client,
    context,
    logger: s.logger,
  });
}

describe("message shortcut", () => {
  it("acks before callOut is awaited", async () => {
    const s = setup({ status: "posted" });
    await invoke(s);
    expect(s.calls).toEqual([
      "ack",
      "callOut:start",
      "callOut:end",
      "chat.postEphemeral",
    ]);
  });

  it("calls out the message's channel/ts for the invoker, as a shortcut", async () => {
    const s = setup({ status: "posted" });
    await invoke(s);
    expect(s.callOut).toHaveBeenCalledTimes(1);
    expect(s.callOut).toHaveBeenCalledWith({
      client: s.client,
      botUserId: BOT,
      target: { channel: CHANNEL, ts: TS, threadTs: undefined },
      invoker: INVOKER,
      trigger: "shortcut",
    });
  });

  it("passes a thread reply's parent and answers in the thread", async () => {
    const s = setup({ status: "posted" });
    await invoke(s, payload({ thread_ts: PARENT_TS }));
    expect(s.callOut).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { channel: CHANNEL, ts: TS, threadTs: PARENT_TS },
      }),
    );
    expect(s.client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: PARENT_TS }),
    );
  });

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
  ])("gives the invoker ephemeral feedback for %j", async (result, text) => {
    expect(feedbackText(result)).toBe(text);
    const s = setup(result);
    await invoke(s);
    expect(s.client.chat.postEphemeral).toHaveBeenCalledTimes(1);
    expect(s.client.chat.postEphemeral).toHaveBeenCalledWith({
      channel: CHANNEL,
      user: INVOKER,
      text,
    });
  });

  it("never posts a non-ephemeral message naming the invoker", async () => {
    for (const result of [
      { status: "posted" },
      { status: "already" },
      { status: "error", reason: "not_in_channel" },
    ] as const) {
      const s = setup(result);
      await invoke(s);
      expect(s.client.chat.postMessage).not.toHaveBeenCalled();
      for (const [args] of s.client.chat.postEphemeral.mock
        .calls as unknown as [{ user: string; text: string }][]) {
        expect(args.user).toBe(INVOKER);
        expect(args.text).not.toContain(INVOKER);
      }
    }
  });

  it("logs a postEphemeral failure and doesn't throw", async () => {
    const s = setup({ status: "error", reason: "not_in_channel" });
    s.client.chat.postEphemeral.mockRejectedValueOnce(
      new Error("An API error occurred: not_in_channel"),
    );
    await expect(invoke(s)).resolves.toBeUndefined();
    expect(s.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("postEphemeral failed"),
    );
  });

  it("gives generic feedback without calling out when the bot id is unknown", async () => {
    const s = setup({ status: "posted" });
    await invoke(s, payload(), {});
    expect(s.callOut).not.toHaveBeenCalled();
    expect(s.logger.error).toHaveBeenCalled();
    expect(s.client.chat.postEphemeral).toHaveBeenCalledWith({
      channel: CHANNEL,
      user: INVOKER,
      text: "Couldn't call that out, sorry.",
    });
  });
});
