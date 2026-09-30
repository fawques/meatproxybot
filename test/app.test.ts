import { App, LogLevel } from "@slack/bolt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, registerHandlers } from "../src/app.js";
import type { Config } from "../src/config.js";

const config: Config = {
  slackBotToken: "xoxb-test",
  slackAppToken: "xapp-test",
  triggerEmoji: "meat_proxy",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createApp", () => {
  it("builds the app without calling Slack when token verification is off", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp(config, {
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
      appToken: config.slackAppToken,
      socketMode: true,
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
      appToken: config.slackAppToken,
      socketMode: true,
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
});
