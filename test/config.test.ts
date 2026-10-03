import { describe, expect, it } from "vitest";
import {
  ConfigError,
  loadConfig,
  getTriggerEmojiForWorkspace,
} from "../src/config.js";
import { InMemoryWorkspaceStore } from "../src/workspaceStore.js";

const valid = {
  SLACK_BOT_TOKEN: "xoxb-123",
  SLACK_SIGNING_SECRET: "my-signing-secret",
};

describe("loadConfig", () => {
  it("loads tokens and defaults PORT to 3000 and TRIGGER_EMOJI to meat_proxy", () => {
    expect(loadConfig(valid)).toEqual({
      slackBotToken: "xoxb-123",
      slackSigningSecret: "my-signing-secret",
      port: 3000,
      triggerEmoji: "meat_proxy",
    });
  });

  it("uses TRIGGER_EMOJI when set, stripping surrounding colons", () => {
    expect(
      loadConfig({ ...valid, TRIGGER_EMOJI: ":robot_face:" }).triggerEmoji,
    ).toBe("robot_face");
  });

  it("uses PORT when set as a valid integer", () => {
    expect(loadConfig({ ...valid, PORT: "8080" }).port).toBe(8080);
  });

  it.each(["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"])(
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
    expect(message).toMatch(/SLACK_SIGNING_SECRET is missing/);
  });

  it("rejects SLACK_BOT_TOKEN with the wrong prefix", () => {
    expect(() =>
      loadConfig({ SLACK_BOT_TOKEN: "xapp-1", SLACK_SIGNING_SECRET: "secret" }),
    ).toThrow(/SLACK_BOT_TOKEN must start with "xoxb-"/);
  });

  it("rejects PORT as a non-integer", () => {
    expect(() => loadConfig({ ...valid, PORT: "abc" })).toThrow(
      /PORT must be an integer from 1 to 65535/,
    );
  });

  it("rejects PORT as out of range", () => {
    expect(() => loadConfig({ ...valid, PORT: "0" })).toThrow(
      /PORT must be an integer from 1 to 65535/,
    );
  });

  it("rejects an invalid TRIGGER_EMOJI", () => {
    expect(() =>
      loadConfig({ ...valid, TRIGGER_EMOJI: "not an emoji" }),
    ).toThrow(/TRIGGER_EMOJI/);
  });
});

describe("getTriggerEmojiForWorkspace", () => {
  it("returns workspace-specific emoji when configured", () => {
    const store = new InMemoryWorkspaceStore();
    store.setTriggerEmoji("T123", "robot_face");
    const config = {
      slackBotToken: "xoxb-123",
      slackAppToken: "xapp-456",
      triggerEmoji: "meat_proxy",
      workspaceStore: store,
    };
    expect(getTriggerEmojiForWorkspace(config, "T123")).toBe("robot_face");
  });

  it("falls back to global trigger emoji when workspace has no configuration", () => {
    const store = new InMemoryWorkspaceStore();
    const config = {
      slackBotToken: "xoxb-123",
      slackAppToken: "xapp-456",
      triggerEmoji: "meat_proxy",
      workspaceStore: store,
    };
    expect(getTriggerEmojiForWorkspace(config, "T999")).toBe("meat_proxy");
  });

  it("uses global emoji when no workspace store is configured", () => {
    const config = {
      slackBotToken: "xoxb-123",
      slackAppToken: "xapp-456",
      triggerEmoji: "meat_proxy",
    };
    expect(getTriggerEmojiForWorkspace(config, "T123")).toBe("meat_proxy");
  });

  it("allows different workspaces to use different emoji", () => {
    const store = new InMemoryWorkspaceStore();
    store.setTriggerEmoji("T123", "robot_face");
    store.setTriggerEmoji("T456", "tada");
    const config = {
      slackBotToken: "xoxb-123",
      slackAppToken: "xapp-456",
      triggerEmoji: "meat_proxy",
      workspaceStore: store,
    };
    expect(getTriggerEmojiForWorkspace(config, "T123")).toBe("robot_face");
    expect(getTriggerEmojiForWorkspace(config, "T456")).toBe("tada");
    expect(getTriggerEmojiForWorkspace(config, "T999")).toBe("meat_proxy");
  });
});
