import { LogLevel, type App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";

const deleteInstallation = vi.fn<(query: unknown) => Promise<void>>();

// createApp builds a PostgresInstallationStore in OAuth mode; swap it for a
// fake so the tests run without a database.
vi.mock("../src/installationStore.js", () => ({
  PostgresInstallationStore: class {
    init = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    delete = deleteInstallation;
  },
}));

const { createApp } = await import("../src/app.js");

const config: Config = {
  slackBotToken: "xoxb-test",
  slackSigningSecret: "test-signing-secret",
  port: 3000,
  triggerEmoji: "meat_proxy",
  clientId: "client-id",
  clientSecret: "client-secret",
  stateSecret: "state-secret",
  databaseUrl: "postgres://localhost/test",
  databaseSchema: "meatproxybot_test",
};

function envelope(
  event: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  // The shape Slack sends: team_id lives on the outer envelope, not in event.
  return {
    token: "verification-token",
    team_id: "T123",
    api_app_id: "A123",
    event,
    type: "event_callback",
    event_id: "Ev123",
    event_time: 1700000000,
    ...extra,
  };
}

async function send(app: App, body: Record<string, unknown>): Promise<void> {
  await app.processEvent({ body, ack: () => Promise.resolve() });
}

describe("OAuth cleanup handlers", () => {
  let app: App;

  beforeEach(async () => {
    deleteInstallation.mockReset();
    deleteInstallation.mockResolvedValue(undefined);
    app = await createApp(config, {
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
  });

  it("deletes the installation when the app is uninstalled", async () => {
    await send(app, envelope({ type: "app_uninstalled" }));
    expect(deleteInstallation).toHaveBeenCalledOnce();
    expect(deleteInstallation).toHaveBeenCalledWith({
      teamId: "T123",
      isEnterpriseInstall: false,
    });
  });

  it("passes the enterprise on to the store for an Enterprise Grid workspace", async () => {
    // isEnterpriseInstall: false makes the store delete by team alone (see
    // installationStore.test.ts), so the row saved without it still goes.
    await send(
      app,
      envelope(
        { type: "app_uninstalled" },
        {
          enterprise_id: "E123",
          authorizations: [
            {
              enterprise_id: "E123",
              team_id: "T123",
              user_id: "U999",
              is_bot: true,
              is_enterprise_install: false,
            },
          ],
        },
      ),
    );
    expect(deleteInstallation).toHaveBeenCalledWith({
      teamId: "T123",
      enterpriseId: "E123",
      isEnterpriseInstall: false,
    });
  });

  it("deletes the installation when the bot token is revoked", async () => {
    await send(
      app,
      envelope({
        type: "tokens_revoked",
        tokens: { oauth: ["U111"], bot: ["U999"] },
      }),
    );
    expect(deleteInstallation).toHaveBeenCalledOnce();
    expect(deleteInstallation).toHaveBeenCalledWith({
      teamId: "T123",
      isEnterpriseInstall: false,
    });
  });

  it("keeps the installation when only user tokens are revoked", async () => {
    await send(
      app,
      envelope({ type: "tokens_revoked", tokens: { oauth: ["U111"] } }),
    );
    await send(
      app,
      envelope({
        type: "tokens_revoked",
        tokens: { oauth: ["U111"], bot: [] },
      }),
    );
    expect(deleteInstallation).not.toHaveBeenCalled();
  });

  it("does not throw when the store fails to delete", async () => {
    deleteInstallation.mockRejectedValue(new Error("db down"));
    await expect(
      send(app, envelope({ type: "app_uninstalled" })),
    ).resolves.toBeUndefined();
  });
});
