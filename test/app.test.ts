import { App, LogLevel } from "@slack/bolt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, registerHandlers } from "../src/app.js";
import type { Config } from "../src/config.js";

const config: Config = {
  slackBotToken: "xoxb-test",
  slackSigningSecret: "test-signing-secret",
  port: 3000,
  triggerEmoji: "meat_proxy",
  databaseSchema: "meatproxybot_prod",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createApp", () => {
  it("builds the app without calling Slack when token verification is off", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = await createApp(config, {
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    expect(app).toBeInstanceOf(App);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("registerHandlers", () => {
  it("registers handlers on an app that is not connected", () => {
    const app = new App({
      token: config.slackBotToken,
      signingSecret: config.slackSigningSecret,
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    expect(() => {
      registerHandlers(app, config);
    }).not.toThrow();
  });

  it("registers the reaction_added trigger", () => {
    const app = new App({
      token: config.slackBotToken,
      signingSecret: config.slackSigningSecret,
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    const eventSpy = vi.spyOn(app, "event");
    registerHandlers(app, config);
    expect(eventSpy).toHaveBeenCalledWith(
      "reaction_added",
      expect.any(Function),
    );
  });

  it("registers the message shortcut", () => {
    const app = new App({
      token: config.slackBotToken,
      signingSecret: config.slackSigningSecret,
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    const shortcut = vi.spyOn(app, "shortcut");
    registerHandlers(app, config);
    expect(shortcut).toHaveBeenCalledWith(
      "call_out_meat_proxy",
      expect.any(Function),
    );
  });

  it("registers the /meatproxy slash command", () => {
    const app = new App({
      token: config.slackBotToken,
      signingSecret: config.slackSigningSecret,
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    const command = vi.spyOn(app, "command");
    registerHandlers(app, config);
    expect(command).toHaveBeenCalledWith("/meatproxy", expect.any(Function));
  });
});

describe("OAuth routes", () => {
  it("can build app with publicBaseUrl in config", async () => {
    const oauthConfig: Config = {
      slackBotToken: "xoxb-test",
      slackSigningSecret: "test-signing-secret",
      port: 3000,
      triggerEmoji: "meat_proxy",
      publicBaseUrl: "https://api.example.com/meatproxybot",
      databaseSchema: "meatproxybot_prod",
    };

    const app = await createApp(oauthConfig, {
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    expect(app).toBeInstanceOf(App);
  });
});
