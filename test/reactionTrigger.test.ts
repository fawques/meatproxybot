import { App, LogLevel } from "@slack/bolt";
import { describe, expect, it, vi } from "vitest";
import type { callOut, CallOutResult } from "../src/callOut.js";
import type { Config } from "../src/config.js";
import { registerReactionTrigger } from "../src/reactionTrigger.js";

const BOT = "UBOT";
const REACTOR = "UREACTOR";
const CHANNEL = "C123";
const TS = "1700000000.000100";

const baseConfig: Config = {
  slackBotToken: "xoxb-test",
  slackSigningSecret: "test-signing-secret",
  port: 3000,
  triggerEmoji: "meat_proxy",
  databaseSchema: "meatproxybot_prod",
};

type Listener = (args: Record<string, unknown>) => Promise<void>;

/**
 * Registers the reaction trigger on an offline app with a mocked callOut and
 * returns the registered reaction_added listener.
 */
function setup(
  opts: {
    config?: Partial<Config>;
    callOut?: () => Promise<CallOutResult>;
  } = {},
) {
  const app = new App({
    token: baseConfig.slackBotToken,
    signingSecret: baseConfig.slackSigningSecret,
    logLevel: LogLevel.ERROR,
    tokenVerificationEnabled: false,
  });
  const eventSpy = vi.spyOn(app, "event");
  const callOutMock = vi.fn<typeof callOut>(
    opts.callOut ?? (() => Promise.resolve({ status: "posted" })),
  );
  registerReactionTrigger(app, { ...baseConfig, ...opts.config }, callOutMock);

  expect(eventSpy).toHaveBeenCalledTimes(1);
  const [eventName, listener] = eventSpy.mock.calls[0] as unknown as [
    string,
    Listener,
  ];
  expect(eventName).toBe("reaction_added");

  const client = { marker: "client" };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const fire = (
    event: {
      reaction?: string;
      user?: string;
      item?: Record<string, string>;
    } = {},
  ) =>
    listener({
      event: {
        type: "reaction_added",
        user: event.user ?? REACTOR,
        reaction: event.reaction ?? "meat_proxy",
        item_user: "UPOSTER",
        item: event.item ?? { type: "message", channel: CHANNEL, ts: TS },
        event_ts: "1700000001.000000",
      },
      context: { botUserId: BOT },
      client,
      logger,
    });
  return { callOutMock, client, logger, fire };
}

describe("reaction trigger", () => {
  it("calls out a message reacted to with the trigger emoji", async () => {
    const { callOutMock, client, logger, fire } = setup();
    await fire();
    expect(callOutMock).toHaveBeenCalledTimes(1);
    expect(callOutMock).toHaveBeenCalledWith({
      client,
      botUserId: BOT,
      target: { channel: CHANNEL, ts: TS },
      invoker: REACTOR,
      trigger: "reaction",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("ignores any other emoji", async () => {
    const { callOutMock, fire } = setup();
    await fire({ reaction: "thumbsup" });
    expect(callOutMock).not.toHaveBeenCalled();
  });

  it("ignores reactions on items that are not messages", async () => {
    const { callOutMock, fire } = setup();
    await fire({ item: { type: "file", file: "F123" } });
    expect(callOutMock).not.toHaveBeenCalled();
  });

  it("ignores the bot's own reaction, so it does not loop", async () => {
    const { callOutMock, fire } = setup();
    await fire({ user: BOT });
    expect(callOutMock).not.toHaveBeenCalled();
  });

  it("respects a custom TRIGGER_EMOJI", async () => {
    const { callOutMock, fire } = setup({
      config: { triggerEmoji: "robot_face" },
    });
    await fire({ reaction: "meat_proxy" });
    expect(callOutMock).not.toHaveBeenCalled();
    await fire({ reaction: "robot_face" });
    expect(callOutMock).toHaveBeenCalledTimes(1);
  });

  it("logs an error result at warn level", async () => {
    const { logger, fire } = setup({
      callOut: () => Promise.resolve({ status: "error", reason: "dm" }),
    });
    await expect(fire()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("dm");
  });

  it("does not log a duplicate", async () => {
    const { logger, fire } = setup({
      callOut: () => Promise.resolve({ status: "already" }),
    });
    await fire();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs a thrown exception at warn level instead of throwing", async () => {
    const { logger, fire } = setup({
      callOut: () => Promise.reject(new Error("boom")),
    });
    await expect(fire()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("boom");
  });
});
