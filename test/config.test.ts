import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const valid = {
  SLACK_BOT_TOKEN: "xoxb-123",
  SLACK_APP_TOKEN: "xapp-456",
};

describe("loadConfig", () => {
  it("loads tokens and defaults TRIGGER_EMOJI to meat_proxy", () => {
    expect(loadConfig(valid)).toEqual({
      slackBotToken: "xoxb-123",
      slackAppToken: "xapp-456",
      triggerEmoji: "meat_proxy",
    });
  });

  it("uses TRIGGER_EMOJI when set, stripping surrounding colons", () => {
    expect(
      loadConfig({ ...valid, TRIGGER_EMOJI: ":robot_face:" }).triggerEmoji,
    ).toBe("robot_face");
  });

  it.each(["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"])(
    "names %s when it is missing",
    (name) => {
      const env: Record<string, string> = { ...valid };
      env[name] = "";
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(new RegExp(`${name} is missing`));
    },
  );

  it("names every missing variable at once", () => {
    let message = "";
    try {
      loadConfig({});
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/SLACK_BOT_TOKEN is missing/);
    expect(message).toMatch(/SLACK_APP_TOKEN is missing/);
  });

  it("rejects tokens with the wrong prefix", () => {
    expect(() =>
      loadConfig({ SLACK_BOT_TOKEN: "xapp-1", SLACK_APP_TOKEN: "xoxb-2" }),
    ).toThrow(
      /SLACK_BOT_TOKEN must start with "xoxb-"[\s\S]*SLACK_APP_TOKEN must start with "xapp-"/,
    );
  });

  it("rejects an invalid TRIGGER_EMOJI", () => {
    expect(() =>
      loadConfig({ ...valid, TRIGGER_EMOJI: "not an emoji" }),
    ).toThrow(/TRIGGER_EMOJI/);
  });
});
