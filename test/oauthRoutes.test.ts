import type { AddressInfo } from "node:net";
import { LogLevel, type App } from "@slack/bolt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";

const saveInstallation = vi.fn<(installation: unknown) => Promise<void>>();

// createApp builds a PostgresInstallationStore and a PostgresWorkspaceStore
// in OAuth mode; swap them for fakes so the tests run without a database.
vi.mock("../src/installationStore.js", () => ({
  PostgresInstallationStore: class {
    init = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    save = saveInstallation;
  },
}));
vi.mock("../src/workspaceStore.js", () => ({
  PostgresWorkspaceStore: class {
    init = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
  },
}));

const { createApp, STATE_COOKIE_NAME } = await import("../src/app.js");

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
  publicBaseUrl: "https://api.example.com/meatproxybot",
};

describe("OAuth state cookie", () => {
  let app: App;
  let baseUrl: string;
  let access: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    saveInstallation.mockReset();
    saveInstallation.mockResolvedValue(undefined);
    app = await createApp(config, {
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    access = vi.spyOn(app.client.oauth.v2, "access").mockResolvedValue({
      ok: true,
      app_id: "A123",
      team: { id: "T123" },
      bot_user_id: "U999",
      access_token: "xoxb-installed",
      scope: "chat:write commands",
    });
    const server = await app.start(0);
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    await app.stop();
  });

  async function install(): Promise<{ state: string; cookie: string }> {
    const res = await fetch(`${baseUrl}/slack/install`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    const [cookie] = res.headers.getSetCookie();
    return {
      state: location.searchParams.get("state") ?? "",
      cookie: cookie ?? "",
    };
  }

  function callback(state: string, cookieHeader?: string): Promise<Response> {
    const query = new URLSearchParams({ code: "the-code", state });
    return fetch(`${baseUrl}/slack/oauth_redirect?${query.toString()}`, {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    });
  }

  function cookieValue(setCookie: string): string {
    return setCookie.split(";")[0] ?? "";
  }

  it("sets an HttpOnly, Secure, SameSite=Lax nonce cookie on the bot's path", async () => {
    const { state, cookie } = await install();
    const nonce =
      Buffer.from(state, "base64url").toString("utf8").split(".")[0] ?? "";

    expect(cookieValue(cookie)).toBe(`${STATE_COOKIE_NAME}=${nonce}`);
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("Path=/meatproxybot");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("completes the install when the cookie matches the state, then clears it", async () => {
    const { state, cookie } = await install();

    const res = await callback(state, cookieValue(cookie));

    expect(res.status).toBe(200);
    expect(access).toHaveBeenCalledOnce();
    expect(saveInstallation).toHaveBeenCalledOnce();
    const [cleared] = res.headers.getSetCookie();
    expect(cleared).toContain(`${STATE_COOKIE_NAME}=;`);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/meatproxybot");
  });

  it("rejects a callback without the state cookie", async () => {
    const { state } = await install();

    const res = await callback(state);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("does not match this browser");
    expect(access).not.toHaveBeenCalled();
    expect(saveInstallation).not.toHaveBeenCalled();
  });

  it("rejects a valid state from another browser's install", async () => {
    const victim = await install();
    const attacker = await install();

    const res = await callback(attacker.state, cookieValue(victim.cookie));

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("does not match this browser");
    expect(access).not.toHaveBeenCalled();
    expect(saveInstallation).not.toHaveBeenCalled();
  });

  it("rejects a cookie with the wrong value", async () => {
    const { state } = await install();

    const res = await callback(state, `${STATE_COOKIE_NAME}=not-the-nonce`);

    expect(res.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
  });
});
