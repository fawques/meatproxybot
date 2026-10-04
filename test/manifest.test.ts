import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BOT_SCOPES } from "../src/scopes.js";

interface Manifest {
  features: {
    app_home?: {
      messages_tab_enabled?: boolean;
      messages_tab_read_only_enabled?: boolean;
    };
    slash_commands: { command: string; url: string; usage_hint?: string }[];
    shortcuts: { name: string; type: string; callback_id: string }[];
  };
  oauth_config: { scopes: { bot: string[] } };
  settings: {
    socket_mode_enabled: boolean;
    interactivity: { is_enabled: boolean; request_url: string };
    event_subscriptions: { bot_events: string[]; request_url: string };
  };
  display_information: {
    name: string;
    description: string;
    long_description?: string;
    background_color: string;
  };
}

const manifest = parse(
  readFileSync(new URL("../manifest.yml", import.meta.url), "utf8"),
) as Manifest;

/**
 * Read PNG dimensions from file buffer
 */
function getPNGDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.length < 24) return null;
  if (
    !buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return null;

  // IHDR chunk is always first after signature (12 bytes header + 13 bytes data)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

describe("manifest.yml", () => {
  it("disables Socket Mode and enables interactivity", () => {
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.settings.interactivity.is_enabled).toBe(true);
  });

  it("declares exactly the bot scopes in BOT_SCOPES", () => {
    const expectedScopes = Object.keys(BOT_SCOPES)
      .filter((key) => !key.startsWith("_"))
      .sort();
    const manifestScopes = manifest.oauth_config.scopes.bot.sort();
    expect(manifestScopes).toEqual(expectedScopes);
  });

  it("sets consistent request URLs for events, interactivity, and slash commands", () => {
    const eventUrl = manifest.settings.event_subscriptions.request_url;
    const interactivityUrl = manifest.settings.interactivity.request_url;
    expect(eventUrl).toBeDefined();
    expect(interactivityUrl).toBe(eventUrl);
    for (const command of manifest.features.slash_commands) {
      expect(command.url).toBe(eventUrl);
    }
  });

  it("subscribes to every required bot event in BOT_SCOPES", () => {
    const requiredEvents = new Set<string>();
    Object.values(BOT_SCOPES).forEach((mapping) => {
      mapping.events.forEach((event) => {
        requiredEvents.add(event);
      });
    });
    for (const event of requiredEvents) {
      expect(manifest.settings.event_subscriptions.bot_events).toContain(event);
    }
  });

  it("declares every feature required by BOT_SCOPES", () => {
    const requiredFeatures = new Set<string>();
    Object.values(BOT_SCOPES).forEach((mapping) => {
      mapping.features.forEach((feature) => {
        requiredFeatures.add(feature);
      });
    });
    for (const feature of requiredFeatures) {
      if (feature === "slash_commands") {
        expect(manifest.features.slash_commands).toBeDefined();
        expect(manifest.features.slash_commands.length).toBeGreaterThan(0);
      } else if (feature === "shortcuts") {
        expect(manifest.features.shortcuts).toBeDefined();
        expect(manifest.features.shortcuts.length).toBeGreaterThan(0);
      }
    }
  });

  it("enables the App Home Messages tab for the welcome DM", () => {
    expect(manifest.features.app_home?.messages_tab_enabled).toBe(true);
    expect(manifest.features.app_home?.messages_tab_read_only_enabled).toBe(
      true,
    );
  });

  it("declares the /meatproxy slash command", () => {
    expect(manifest.features.slash_commands).toContainEqual(
      expect.objectContaining({
        command: "/meatproxy",
        usage_hint: "<message link>",
      }),
    );
  });

  it("declares the call_out_meat_proxy message shortcut", () => {
    expect(manifest.features.shortcuts).toContainEqual({
      name: "🥩 Call out meat proxy",
      type: "message",
      callback_id: "call_out_meat_proxy",
      description: expect.any(String) as string,
    });
  });

  it("has a short description with <= 10 words", () => {
    const wordCount = manifest.display_information.description
      .trim()
      .split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(10);
  });

  it("has a long_description between 175-4000 characters", () => {
    const desc = manifest.display_information.long_description || "";
    expect(desc.length).toBeGreaterThanOrEqual(175);
    expect(desc.length).toBeLessThanOrEqual(4000);
  });
});

describe("marketplace assets", () => {
  it("icon.png exists with correct dimensions (512-2000px square)", () => {
    const buffer = readFileSync(
      new URL("../docs/marketplace/icon.png", import.meta.url),
    );
    const dims = getPNGDimensions(buffer);
    expect(dims).not.toBeNull();
    expect(dims?.width).toBeGreaterThanOrEqual(512);
    expect(dims?.width).toBeLessThanOrEqual(2000);
    expect(dims?.width).toBe(dims?.height);
  });

  it("each screenshot is 1600x1000 PNG under 2MB", () => {
    const screenshots = [
      "screenshot-reaction.png",
      "screenshot-shortcut.png",
      "screenshot-slash.png",
    ];

    for (const name of screenshots) {
      const buffer = readFileSync(
        new URL(`../docs/marketplace/${name}`, import.meta.url),
      );
      const dims = getPNGDimensions(buffer);
      expect(dims?.width).toBe(1600);
      expect(dims?.height).toBe(1000);
      expect(buffer.length).toBeLessThan(2 * 1024 * 1024); // 2MB
    }
  });
});
