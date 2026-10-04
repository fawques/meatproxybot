import { describe, expect, it, vi } from "vitest";
import type { CallOutClient, CallOutResult } from "../src/callOut.js";
import {
  handleMeatproxyCommand,
  INVALID_LINK_TEXT,
  USAGE_TEXT,
  type CommandArgs,
} from "../src/command.js";
import { feedbackText } from "../src/feedback.js";

const BOT = "UBOT";
const INVOKER = "UINVOKER";
const LINK = "https://acme.slack.com/archives/C0123ABCD/p1700000000123456";

function setup(
  text: string,
  opts: {
    result?: CallOutResult;
    botUserId?: string | undefined;
    respondFails?: boolean;
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
    body: { text, user_id: INVOKER },
    respond,
    context: {
      botUserId: "botUserId" in opts ? opts.botUserId : BOT,
      teamId: "T1",
    },
    client,
    logger,
  };
  const run = () => handleMeatproxyCommand(args, { callOut });
  return { run, events, ack, respond, callOut, logger, client };
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
      teamId: "T1",
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
