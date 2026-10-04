import type { Logger } from "@slack/bolt";
import { describe, expect, it, vi } from "vitest";
import {
  installSuccessPage,
  sendWelcomeDm,
  slackAppUrl,
  welcomeText,
} from "../src/onboarding.js";

function fakeLogger(warn = vi.fn()): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn(),
    setName: vi.fn(),
  };
}

describe("slackAppUrl", () => {
  it("deep-links to the app in the workspace", () => {
    expect(slackAppUrl("T123", "A456")).toBe("slack://app?team=T123&id=A456");
  });

  it("opens the workspace when there is no app id", () => {
    expect(slackAppUrl("T123", undefined)).toBe("slack://open?team=T123");
  });
});

describe("installSuccessPage", () => {
  it("escapes the Slack URL in the HTML", () => {
    const page = installSuccessPage('slack://app?team=T"1&id=<A>');
    expect(page).toContain("slack://app?team=T&quot;1&amp;id=&lt;A&gt;");
    expect(page).not.toContain("<A>");
  });
});

describe("welcomeText", () => {
  const text = welcomeText("robot_face");

  it("explains how to invite the bot", () => {
    expect(text).toContain("/invite @meatproxybot");
  });

  it("covers the three triggers and which are anonymous", () => {
    expect(text).toContain("_🥩 Call out meat proxy_");
    expect(text).toContain("`/meatproxy <message link>`* (anonymous)");
    expect(text).toContain("*Message shortcut* (anonymous)");
    expect(text).toContain("React with :robot_face:* (not anonymous");
  });

  it("explains that the trigger emoji must exist and how to change it", () => {
    expect(text).toContain(
      "The reaction trigger only works once :robot_face: exists",
    );
    expect(text).toContain("`/meatproxy emoji <name>`");
  });
});

describe("sendWelcomeDm", () => {
  const args = { botToken: "xoxb-t", userId: "U1", triggerEmoji: "meat_proxy" };

  it("DMs the user with the bot token", async () => {
    const postMessage = vi.fn(() => Promise.resolve({ ok: true }));
    await sendWelcomeDm({ chat: { postMessage } }, args, fakeLogger());
    expect(postMessage).toHaveBeenCalledWith({
      token: "xoxb-t",
      channel: "U1",
      text: welcomeText("meat_proxy"),
    });
  });

  it("logs and swallows a failed DM", async () => {
    const postMessage = vi.fn(() => Promise.reject(new Error("not_allowed")));
    const warn = vi.fn();
    await expect(
      sendWelcomeDm({ chat: { postMessage } }, args, fakeLogger(warn)),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Could not send the welcome DM to U1: not_allowed",
    );
  });
});
