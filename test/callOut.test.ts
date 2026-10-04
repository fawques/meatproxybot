import { describe, expect, it, vi } from "vitest";
import { callOut, type CallOutOptions } from "../src/callOut.js";
import { callouts, renderCallout } from "../src/callouts.js";

const BOT = "UBOT";
const POSTER = "UPOSTER";
const INVOKER = "UINVOKER";
const CHANNEL = "C123";
const TS = "1700000000.000100";
const PARENT_TS = "1700000000.000001";

interface SlackMessage {
  ts: string;
  user?: string;
  thread_ts?: string;
}

/** A WebClient error as thrown for a Slack API error response. */
function slackError(error: string): Error {
  return Object.assign(new Error(`An API error occurred: ${error}`), {
    code: "slack_webapi_platform_error",
    data: { ok: false, error },
  });
}

function mockClient(
  opts: {
    history?: SlackMessage[];
    replies?: SlackMessage[];
    reactions?: { name: string; users: string[] }[];
  } = {},
) {
  const calls: string[] = [];
  const track =
    <T>(name: string, value: () => T) =>
    () => {
      calls.push(name);
      return Promise.resolve(value());
    };
  const client = {
    conversations: {
      history: vi.fn(
        track("conversations.history", () => ({
          ok: true,
          messages: opts.history ?? [{ ts: TS, user: POSTER }],
        })),
      ),
      replies: vi.fn(
        track("conversations.replies", () => ({
          ok: true,
          messages: opts.replies ?? [],
        })),
      ),
    },
    reactions: {
      get: vi.fn(
        track("reactions.get", () => ({
          ok: true,
          message: { ts: TS, reactions: opts.reactions ?? [] },
        })),
      ),
      add: vi.fn(track("reactions.add", () => ({ ok: true }))),
      remove: vi.fn(track("reactions.remove", () => ({ ok: true }))),
    },
    chat: {
      postMessage: vi.fn(track("chat.postMessage", () => ({ ok: true }))),
    },
  };
  return { client, calls };
}

function run(
  client: ReturnType<typeof mockClient>["client"],
  overrides: Partial<CallOutOptions> = {},
) {
  const log = vi.fn<(line: string) => void>();
  const result = callOut({
    client,
    botUserId: BOT,
    target: { channel: CHANNEL, ts: TS },
    invoker: INVOKER,
    trigger: "reaction",
    log,
    rng: () => 0,
    ...overrides,
  });
  return { result, log };
}

function postedText(client: ReturnType<typeof mockClient>["client"]): string {
  const args = client.chat.postMessage.mock.calls[0] as unknown as [
    { text: string },
  ];
  return args[0].text;
}

function auditLine(log: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(log).toHaveBeenCalledTimes(1);
  const [line] = log.mock.calls[0] as [string];
  return JSON.parse(line) as Record<string, unknown>;
}

describe("callOut", () => {
  it("claims with a reaction, then posts in the thread mentioning the poster", async () => {
    const { client, calls } = mockClient();
    const { result, log } = run(client);

    await expect(result).resolves.toEqual({ status: "posted" });
    expect(calls).toEqual([
      "conversations.history",
      "reactions.get",
      "reactions.add",
      "chat.postMessage",
    ]);
    expect(client.conversations.history).toHaveBeenCalledWith({
      channel: CHANNEL,
      latest: TS,
      inclusive: true,
      limit: 1,
    });
    expect(client.reactions.add).toHaveBeenCalledWith({
      channel: CHANNEL,
      timestamp: TS,
      name: "cut_of_meat",
    });
    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: CHANNEL,
      thread_ts: TS,
      text: renderCallout(callouts[0] ?? "", POSTER),
    });
    expect(postedText(client)).toContain(`<@${POSTER}>`);
    expect(auditLine(log)).toEqual({
      event: "callout",
      trigger: "reaction",
      invoker: INVOKER,
      channel: CHANNEL,
      ts: TS,
      poster: POSTER,
      status: "posted",
    });
  });

  it("posts under the existing thread_ts of a thread parent", async () => {
    const { client } = mockClient({
      history: [{ ts: TS, user: POSTER, thread_ts: TS }],
    });
    await expect(run(client).result).resolves.toEqual({ status: "posted" });
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: TS }),
    );
  });

  it("finds a thread reply and posts under its parent thread_ts", async () => {
    // The reply is not in the channel history: history returns an older
    // top-level message instead.
    const { client } = mockClient({
      history: [{ ts: PARENT_TS, user: "USOMEONE" }],
      replies: [
        { ts: PARENT_TS, user: "USOMEONE", thread_ts: PARENT_TS },
        { ts: TS, user: POSTER, thread_ts: PARENT_TS },
      ],
    });
    await expect(run(client).result).resolves.toEqual({ status: "posted" });
    expect(client.conversations.replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL, ts: TS }),
    );
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: PARENT_TS }),
    );
    expect(postedText(client)).toContain(`<@${POSTER}>`);
  });

  it("goes straight to the thread when the trigger knows the parent", async () => {
    const { client } = mockClient({
      replies: [{ ts: TS, user: POSTER, thread_ts: PARENT_TS }],
    });
    const { result } = run(client, {
      target: { channel: CHANNEL, ts: TS, threadTs: PARENT_TS },
      trigger: "shortcut",
    });
    await expect(result).resolves.toEqual({ status: "posted" });
    expect(client.conversations.history).not.toHaveBeenCalled();
    expect(client.conversations.replies).toHaveBeenCalledWith(
      expect.objectContaining({ ts: PARENT_TS }),
    );
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: PARENT_TS }),
    );
  });

  it("does nothing when the bot already reacted", async () => {
    const { client } = mockClient({
      reactions: [{ name: "cut_of_meat", users: ["UOTHER", BOT] }],
    });
    const { result, log } = run(client);
    await expect(result).resolves.toEqual({ status: "already" });
    expect(client.reactions.add).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(auditLine(log)).toMatchObject({ status: "already" });
  });

  it("still calls out when only other users reacted with the emoji", async () => {
    const { client } = mockClient({
      reactions: [{ name: "cut_of_meat", users: ["UOTHER"] }],
    });
    await expect(run(client).result).resolves.toEqual({ status: "posted" });
  });

  it("treats already_reacted as already and does not post", async () => {
    const { client } = mockClient();
    client.reactions.add.mockRejectedValueOnce(slackError("already_reacted"));
    const { result, log } = run(client);
    await expect(result).resolves.toEqual({ status: "already" });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(auditLine(log)).toMatchObject({ status: "already" });
  });

  it("refuses the bot's own message", async () => {
    const { client } = mockClient({ history: [{ ts: TS, user: BOT }] });
    const { result, log } = run(client);
    await expect(result).resolves.toEqual({
      status: "error",
      reason: "own_message",
    });
    expect(client.reactions.add).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(auditLine(log)).toMatchObject({
      status: "error",
      reason: "own_message",
    });
  });

  it("allows self-callouts", async () => {
    const { client } = mockClient({ history: [{ ts: TS, user: INVOKER }] });
    await expect(run(client).result).resolves.toEqual({ status: "posted" });
  });

  it("rejects a DM without calling Slack", async () => {
    const { client, calls } = mockClient();
    const { result, log } = run(client, {
      target: { channel: "D123", ts: TS },
    });
    await expect(result).resolves.toEqual({ status: "error", reason: "dm" });
    expect(calls).toEqual([]);
    expect(auditLine(log)).toMatchObject({
      channel: "D123",
      poster: null,
      status: "error",
      reason: "dm",
    });
  });

  it("rejects a group DM, whose history the bot has no scope for", async () => {
    const { client } = mockClient();
    client.conversations.history.mockRejectedValueOnce(
      slackError("missing_scope"),
    );
    const { result } = run(client, { target: { channel: "G123", ts: TS } });
    await expect(result).resolves.toEqual({ status: "error", reason: "dm" });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("maps Slack not_in_channel", async () => {
    const { client } = mockClient();
    client.conversations.history.mockRejectedValueOnce(
      slackError("not_in_channel"),
    );
    const { result, log } = run(client);
    await expect(result).resolves.toEqual({
      status: "error",
      reason: "not_in_channel",
    });
    expect(client.reactions.add).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(auditLine(log)).toMatchObject({ reason: "not_in_channel" });
  });

  it("maps channel_not_found to not_found", async () => {
    const { client } = mockClient();
    client.conversations.history.mockRejectedValueOnce(
      slackError("channel_not_found"),
    );
    await expect(run(client).result).resolves.toEqual({
      status: "error",
      reason: "not_found",
    });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("maps a missing message to not_found", async () => {
    const { client } = mockClient({ history: [], replies: [] });
    await expect(run(client).result).resolves.toEqual({
      status: "error",
      reason: "not_found",
    });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("maps thread_not_found to not_found", async () => {
    const { client } = mockClient({ history: [] });
    client.conversations.replies.mockRejectedValueOnce(
      slackError("thread_not_found"),
    );
    await expect(run(client).result).resolves.toEqual({
      status: "error",
      reason: "not_found",
    });
  });

  it("releases the claim and reports unknown when posting fails", async () => {
    const { client } = mockClient();
    client.chat.postMessage.mockRejectedValueOnce(slackError("fatal_error"));
    const { result, log } = run(client);
    await expect(result).resolves.toEqual({
      status: "error",
      reason: "unknown",
    });
    expect(client.reactions.remove).toHaveBeenCalledWith({
      channel: CHANNEL,
      timestamp: TS,
      name: "cut_of_meat",
    });
    expect(auditLine(log)).toMatchObject({
      poster: POSTER,
      status: "error",
      reason: "unknown",
    });
  });

  it("never puts the invoker's id in the posted text", async () => {
    for (let i = 0; i < callouts.length; i++) {
      const { client } = mockClient();
      await run(client, {
        target: { channel: `CINVOKER${String(i)}`, ts: TS },
        rng: () => i / callouts.length,
      }).result;
      expect(postedText(client)).not.toContain(INVOKER);
    }
  });

  it("writes the audit line to stdout by default", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { client } = mockClient();
    await callOut({
      client,
      botUserId: BOT,
      target: { channel: CHANNEL, ts: TS },
      invoker: INVOKER,
      trigger: "command",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0] as [string];
    expect(JSON.parse(line)).toMatchObject({
      event: "callout",
      trigger: "command",
      invoker: INVOKER,
      status: "posted",
    });
    spy.mockRestore();
  });

  it("dedup recognizes legacy meat_proxy reaction from the bot", async () => {
    const { client } = mockClient({
      reactions: [{ name: "meat_proxy", users: ["UOTHER", BOT] }],
    });
    const { result, log } = run(client);
    await expect(result).resolves.toEqual({ status: "already" });
    expect(client.reactions.add).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(auditLine(log)).toMatchObject({ status: "already" });
  });

  it("still calls out when only other users reacted with legacy meat_proxy", async () => {
    const { client } = mockClient({
      reactions: [{ name: "meat_proxy", users: ["UOTHER"] }],
    });
    await expect(run(client).result).resolves.toEqual({ status: "posted" });
    expect(client.reactions.add).toHaveBeenCalledWith({
      channel: CHANNEL,
      timestamp: TS,
      name: "cut_of_meat",
    });
  });

  describe("usage tracking", () => {
    it("records the callout with its team, trigger, status and invoker", async () => {
      const recordUsage = vi.fn(() => Promise.resolve());
      const { client } = mockClient();
      await run(client, { teamId: "T1", recordUsage, trigger: "shortcut" })
        .result;
      expect(recordUsage).toHaveBeenCalledExactlyOnceWith({
        teamId: "T1",
        trigger: "shortcut",
        status: "posted",
        invoker: INVOKER,
      });
    });

    it("records failed callouts too", async () => {
      const recordUsage = vi.fn(() => Promise.resolve());
      const { client } = mockClient();
      await run(client, {
        teamId: "T1",
        recordUsage,
        target: { channel: "D123", ts: TS },
      }).result;
      expect(recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ status: "error" }),
      );
    });

    it("skips recording without a team", async () => {
      const recordUsage = vi.fn(() => Promise.resolve());
      const { client } = mockClient();
      await run(client, { recordUsage }).result;
      expect(recordUsage).not.toHaveBeenCalled();
    });

    it("logs a recording failure without failing the callout", async () => {
      const recordUsage = vi.fn(() => Promise.reject(new Error("db down")));
      const { client } = mockClient();
      const { result, log } = run(client, { teamId: "T1", recordUsage });
      await expect(result).resolves.toEqual({ status: "posted" });
      expect(log).toHaveBeenCalledTimes(2);
      expect(JSON.parse(log.mock.calls[1]?.[0] ?? "")).toEqual({
        event: "usage_record_failed",
        trigger: "reaction",
        error: "db down",
      });
    });
  });
});
