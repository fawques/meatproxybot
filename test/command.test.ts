import { describe, expect, it, vi } from "vitest";
import type { CallOutClient, CallOutResult } from "../src/callOut.js";
import {
  currentEmojiText,
  EMOJI_STORE_FAILED_TEXT,
  EMOJI_UNAVAILABLE_TEXT,
  emojiResetText,
  emojiSetText,
  handleMeatproxyCommand,
  INVALID_LINK_TEXT,
  invalidEmojiText,
  USAGE_TEXT,
  type CommandArgs,
} from "../src/command.js";
import { feedbackText } from "../src/feedback.js";
import {
  InMemoryWorkspaceStore,
  type WorkspaceStore,
} from "../src/workspaceStore.js";

const BOT = "UBOT";
const INVOKER = "UINVOKER";
const TEAM = "T123";
const LINK = "https://acme.slack.com/archives/C0123ABCD/p1700000000123456";

function setup(
  text: string,
  opts: {
    result?: CallOutResult;
    botUserId?: string | undefined;
    respondFails?: boolean;
    workspaceStore?: WorkspaceStore | undefined;
  } = {},
) {
  const events: string[] = [];
  const ack = vi.fn(() => {
    events.push("ack");
    return Promise.resolve();
  });
  const respond = vi.fn<CommandArgs["respond"]>(() => {
    events.push("respond");
    return opts.respondFails
      ? Promise.reject(new Error("expired_url"))
      : Promise.resolve();
  });
  const callOut = vi.fn((): Promise<CallOutResult> => {
    events.push("callOut");
    return Promise.resolve(opts.result ?? { status: "posted" });
  });
  const logger = { error: vi.fn() };
  const client = {} as CallOutClient;
  const args: CommandArgs = {
    ack,
    body: { text, user_id: INVOKER, team_id: TEAM },
    respond,
    context: { botUserId: "botUserId" in opts ? opts.botUserId : BOT },
    client,
    logger,
  };
  const workspaceStore =
    "workspaceStore" in opts
      ? opts.workspaceStore
      : new InMemoryWorkspaceStore();
  const config = {
    triggerEmoji: "meat_proxy",
    ...(workspaceStore ? { workspaceStore } : {}),
  };
  const run = () => handleMeatproxyCommand(args, { callOut, config });
  return {
    run,
    events,
    ack,
    respond,
    callOut,
    logger,
    client,
    store: workspaceStore,
  };
}

/** Every respond payload must be ephemeral and must not name the invoker. */
function expectAnonymousEphemeral(
  respond: ReturnType<typeof setup>["respond"],
) {
  expect(respond).toHaveBeenCalled();
  for (const [message] of respond.mock.calls) {
    expect(message.response_type).toBe("ephemeral");
    expect(JSON.stringify(message)).not.toContain(INVOKER);
  }
}

describe("/meatproxy", () => {
  it("calls out the linked message with the invoker and trigger 'command'", async () => {
    const { run, callOut, client } = setup(LINK);
    await run();
    expect(callOut).toHaveBeenCalledOnce();
    expect(callOut).toHaveBeenCalledWith({
      client,
      botUserId: BOT,
      target: { channel: "C0123ABCD", ts: "1700000000.123456" },
      invoker: INVOKER,
      trigger: "command",
    });
  });

  it("parses Slack's angle-bracketed link", async () => {
    const { run, callOut } = setup(`<${LINK}|a message>`);
    await run();
    expect(callOut).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { channel: "C0123ABCD", ts: "1700000000.123456" },
      }),
    );
  });

  it("acks before calling out", async () => {
    const { run, events } = setup(LINK);
    await run();
    expect(events).toEqual(["ack", "callOut", "respond"]);
  });

  it.each<[CallOutResult]>([
    [{ status: "posted" }],
    [{ status: "already" }],
    [{ status: "error", reason: "dm" }],
    [{ status: "error", reason: "own_message" }],
    [{ status: "error", reason: "not_in_channel" }],
    [{ status: "error", reason: "not_found" }],
    [{ status: "error", reason: "unknown" }],
  ])("answers %j ephemerally with the shared copy", async (result) => {
    const { run, respond } = setup(LINK, { result });
    await run();
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      response_type: "ephemeral",
      text: feedbackText(result),
    });
    expectAnonymousEphemeral(respond);
  });

  it.each(["", "   ", "help", " HELP "])(
    "shows usage for %j without calling out",
    async (text) => {
      const { run, events, respond, callOut } = setup(text);
      await run();
      expect(callOut).not.toHaveBeenCalled();
      expect(events[0]).toBe("ack");
      expect(respond).toHaveBeenCalledExactlyOnceWith({
        response_type: "ephemeral",
        text: USAGE_TEXT,
      });
      expectAnonymousEphemeral(respond);
    },
  );

  it.each([
    "garbage",
    "https://example.com/archives/C0123ABCD/p1700000000123456",
    "https://acme.slack.com/archives/D0123ABCD/p1700000000123456",
  ])("rejects %j without calling out", async (text) => {
    const { run, respond, callOut } = setup(text);
    await run();
    expect(callOut).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      response_type: "ephemeral",
      text: INVALID_LINK_TEXT,
    });
    expectAnonymousEphemeral(respond);
  });

  it("logs and does not throw when respond fails", async () => {
    const { run, logger } = setup(LINK, { respondFails: true });
    await expect(run()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("answers with a generic error when the bot user id is unknown", async () => {
    const { run, respond, callOut, logger } = setup(LINK, {
      botUserId: undefined,
    });
    await run();
    expect(callOut).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      response_type: "ephemeral",
      text: "Couldn't call that out, sorry.",
    });
  });
});

describe("/meatproxy emoji", () => {
  /** Runs the command and returns its only, ephemeral reply. */
  async function replyTo(
    text: string,
    opts: Parameters<typeof setup>[1] = {},
  ): Promise<string> {
    const { run, respond, callOut } = setup(text, opts);
    await run();
    expect(callOut).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledOnce();
    expectAnonymousEphemeral(respond);
    return respond.mock.calls[0]?.[0].text ?? "";
  }

  it("shows the default when the workspace has no setting", async () => {
    expect(await replyTo("emoji")).toBe(
      currentEmojiText("meat_proxy", "default"),
    );
  });

  it("shows the workspace setting", async () => {
    const store = new InMemoryWorkspaceStore();
    await store.setTriggerEmoji(TEAM, "robot_face");
    const reply = await replyTo("  EMOJI  ", { workspaceStore: store });
    expect(reply).toBe(currentEmojiText("robot_face", "workspace"));
    expect(reply).toContain(":robot_face:");
  });

  it.each(["robot_face", ":robot_face:"])(
    "sets the trigger emoji from %j",
    async (name) => {
      const store = new InMemoryWorkspaceStore();
      const reply = await replyTo(`emoji ${name}`, { workspaceStore: store });
      expect(reply).toBe(emojiSetText("robot_face"));
      expect(reply).toContain("only works if that emoji exists");
      expect(await store.getTriggerEmoji(TEAM)).toBe("robot_face");
      expect(await store.getTriggerEmoji("T999")).toBeUndefined();
    },
  );

  it("resets to the default", async () => {
    const store = new InMemoryWorkspaceStore();
    await store.setTriggerEmoji(TEAM, "robot_face");
    const reply = await replyTo("emoji reset", { workspaceStore: store });
    expect(reply).toBe(emojiResetText("meat_proxy"));
    expect(reply).toContain("only works if that emoji exists");
    expect(await store.getTriggerEmoji(TEAM)).toBeUndefined();
  });

  it.each(["not an emoji", "Robot_Face", "robot:face", "🤖"])(
    "rejects %j without saving",
    async (name) => {
      const store = new InMemoryWorkspaceStore();
      await store.setTriggerEmoji(TEAM, "tada");
      const reply = await replyTo(`emoji ${name}`, { workspaceStore: store });
      expect(reply).toBe(invalidEmojiText(name));
      expect(await store.getTriggerEmoji(TEAM)).toBe("tada");
    },
  );

  it("explains that it can't be changed without a database", async () => {
    expect(
      await replyTo("emoji robot_face", { workspaceStore: undefined }),
    ).toBe(EMOJI_UNAVAILABLE_TEXT);
    expect(await replyTo("emoji reset", { workspaceStore: undefined })).toBe(
      EMOJI_UNAVAILABLE_TEXT,
    );
    expect(await replyTo("emoji", { workspaceStore: undefined })).toBe(
      currentEmojiText("meat_proxy", "default"),
    );
  });

  it("logs and answers with an error when the store fails", async () => {
    const store = new InMemoryWorkspaceStore();
    vi.spyOn(store, "setTriggerEmoji").mockRejectedValue(new Error("db down"));
    const { run, respond, logger } = setup("emoji robot_face", {
      workspaceStore: store,
    });
    await run();
    expect(logger.error).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      response_type: "ephemeral",
      text: EMOJI_STORE_FAILED_TEXT,
    });
  });

  it("documents the subcommands in the usage text", () => {
    expect(USAGE_TEXT).toContain("/meatproxy emoji <name>");
    expect(USAGE_TEXT).toContain("/meatproxy emoji reset");
  });
});
