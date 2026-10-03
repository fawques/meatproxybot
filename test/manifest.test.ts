import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BOT_SCOPES } from "../src/scopes.js";

interface Manifest {
  features: {
    slash_commands: { command: string; usage_hint?: string }[];
    shortcuts: { name: string; type: string; callback_id: string }[];
  };
  oauth_config: { scopes: { bot: string[] } };
  settings: {
    socket_mode_enabled: boolean;
    interactivity: { is_enabled: boolean };
    event_subscriptions: { bot_events: string[] };
  };
}

const manifest = parse(
  readFileSync(new URL("../manifest.yml", import.meta.url), "utf8"),
) as Manifest;

describe("manifest.yml", () => {
  it("enables Socket Mode and interactivity", () => {
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.settings.interactivity.is_enabled).toBe(true);
  });

  it("declares exactly the bot scopes in BOT_SCOPES", () => {
    const expectedScopes = Object.keys(BOT_SCOPES).sort();
    const manifestScopes = manifest.oauth_config.scopes.bot.sort();
    expect(manifestScopes).toEqual(expectedScopes);
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
});
