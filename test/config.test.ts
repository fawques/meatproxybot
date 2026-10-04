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
      databaseSchema: "meatproxybot_prod",
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

  it("names SLACK_SIGNING_SECRET when it is missing", () => {
    const env: Record<string, string> = { ...valid };
    env.SLACK_SIGNING_SECRET = "";
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/SLACK_SIGNING_SECRET is missing/);
  });

  it("requires either OAuth or legacy mode configuration", () => {
    const env: Record<string, string> = {
      SLACK_SIGNING_SECRET: "secret",
    };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(
      /Either OAuth mode.*or legacy mode.*must be configured/,
    );
  });

  it("names every missing variable at once", () => {
    let message = "";
    try {
      loadConfig({});
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/SLACK_SIGNING_SECRET is missing/);
    expect(message).toMatch(
      /Either OAuth mode.*or legacy mode.*must be configured/,
    );
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

  describe("OAuth mode", () => {
    const oauthBase = {
      SLACK_SIGNING_SECRET: "my-signing-secret",
      SLACK_CLIENT_ID: "my-client-id",
      SLACK_CLIENT_SECRET: "my-client-secret",
      SLACK_STATE_SECRET: "my-state-secret",
      DATABASE_URL: "postgresql://user:pass@localhost/db",
    };

    it("requires PUBLIC_BASE_URL in OAuth mode", () => {
      expect(() => loadConfig(oauthBase)).toThrow(ConfigError);
      expect(() => loadConfig(oauthBase)).toThrow(
        /PUBLIC_BASE_URL is required for OAuth mode/,
      );
    });

    it("accepts valid PUBLIC_BASE_URL with https://", () => {
      const config = loadConfig({
        ...oauthBase,
        PUBLIC_BASE_URL: "https://api.example.com/meatproxybot",
      });
      expect(config.publicBaseUrl).toBe("https://api.example.com/meatproxybot");
    });

    it("trims trailing slashes from PUBLIC_BASE_URL", () => {
      const config = loadConfig({
        ...oauthBase,
        PUBLIC_BASE_URL: "https://api.example.com/meatproxybot/",
      });
      expect(config.publicBaseUrl).toBe("https://api.example.com/meatproxybot");
    });

    it("rejects PUBLIC_BASE_URL not starting with https://", () => {
      expect(() =>
        loadConfig({
          ...oauthBase,
          PUBLIC_BASE_URL: "http://api.example.com/meatproxybot",
        }),
      ).toThrow(/PUBLIC_BASE_URL must start with "https:\/\/"/);
    });

    it("includes PUBLIC_BASE_URL in error message when OAuth mode is incomplete", () => {
      expect(() =>
        loadConfig({
          SLACK_SIGNING_SECRET: "secret",
          SLACK_CLIENT_ID: "id",
        }),
      ).toThrow(
        /Either OAuth mode.*SLACK_CLIENT_SECRET, SLACK_STATE_SECRET, DATABASE_URL, PUBLIC_BASE_URL.*must be configured/,
      );
    });
  });
});

describe("getTriggerEmojiForWorkspace", () => {
  it("returns workspace-specific emoji when configured", () => {
    const store = new InMemoryWorkspaceStore();
    store.setTriggerEmoji("T123", "robot_face");
    const config = {
      slackBotToken: "xoxb-123",
      slackSigningSecret: "secret-123",
      port: 3000,
      triggerEmoji: "meat_proxy",
      databaseSchema: "meatproxybot_prod",
      workspaceStore: store,
    };
    expect(getTriggerEmojiForWorkspace(config, "T123")).toBe("robot_face");
  });

  it("falls back to global trigger emoji when workspace has no configuration", () => {
    const store = new InMemoryWorkspaceStore();
    const config = {
      slackBotToken: "xoxb-123",
      slackSigningSecret: "secret-123",
      port: 3000,
      triggerEmoji: "meat_proxy",
      databaseSchema: "meatproxybot_prod",
      workspaceStore: store,
    };
    expect(getTriggerEmojiForWorkspace(config, "T999")).toBe("meat_proxy");
  });

  it("uses global emoji when no workspace store is configured", () => {
    const config = {
      slackBotToken: "xoxb-123",
      slackSigningSecret: "secret-123",
      port: 3000,
      triggerEmoji: "meat_proxy",
      databaseSchema: "meatproxybot_prod",
    };
    expect(getTriggerEmojiForWorkspace(config, "T123")).toBe("meat_proxy");
  });

  it("allows different workspaces to use different emoji", () => {
    const store = new InMemoryWorkspaceStore();
    store.setTriggerEmoji("T123", "robot_face");
    store.setTriggerEmoji("T456", "tada");
    const config = {
      slackBotToken: "xoxb-123",
      slackSigningSecret: "secret-123",
      port: 3000,
      triggerEmoji: "meat_proxy",
      databaseSchema: "meatproxybot_prod",
      workspaceStore: store,
    };
    expect(getTriggerEmojiForWorkspace(config, "T123")).toBe("robot_face");
    expect(getTriggerEmojiForWorkspace(config, "T456")).toBe("tada");
    expect(getTriggerEmojiForWorkspace(config, "T999")).toBe("meat_proxy");
  });
});
