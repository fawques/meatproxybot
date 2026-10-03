import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface Manifest {
  features: {
    slash_commands: { command: string; usage_hint?: string }[];
    shortcuts: { name: string; type: string; callback_id: string }[];
  };
  oauth_config: { scopes: { bot: string[] } };
  settings: {
    socket_mode_enabled: boolean;
    interactivity: { is_enabled: boolean; request_url: string };
    event_subscriptions: { bot_events: string[]; request_url: string };
    slash_commands_url: string;
  };
}

const manifest = parse(
  readFileSync(new URL("../manifest.yml", import.meta.url), "utf8"),
) as Manifest;

describe("manifest.yml", () => {
  it("disables Socket Mode and enables interactivity", () => {
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.settings.interactivity.is_enabled).toBe(true);
  });

  it("sets consistent request URLs for events, interactivity, and slash commands", () => {
    const eventUrl = manifest.settings.event_subscriptions.request_url;
    const interactivityUrl = manifest.settings.interactivity.request_url;
    const commandsUrl = manifest.settings.slash_commands_url;
    expect(eventUrl).toBeDefined();
    expect(interactivityUrl).toBe(eventUrl);
    expect(commandsUrl).toBe(eventUrl);
  });

  it("declares every bot scope the MVP needs", () => {
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining([
        "chat:write",
        "reactions:read",
        "reactions:write",
        "commands",
        "channels:history",
        "groups:history",
      ]),
    );
  });

  it("subscribes to reaction_added", () => {
    expect(manifest.settings.event_subscriptions.bot_events).toContain(
      "reaction_added",
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
});
