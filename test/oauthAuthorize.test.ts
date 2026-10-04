import { LogLevel } from "@slack/bolt";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";

// A stand-in for Postgres that keeps installation rows in memory. It answers
// the store's upsert, select and delete (matching on enterprise_id only when
// the SQL does); schema statements return no rows.
interface Row {
  team_id: string;
  enterprise_id: string;
  bot_token: string;
  bot_id: string | null;
  bot_user_id: string | null;
  app_id: string | null;
}
const rows = vi.hoisted(() => new Map<string, Row>());

vi.mock("pg", () => {
  const query = (sql: string, params: (string | null)[] = []) => {
    const key = `${String(params[0])}/${String(params[1])}`;
    if (sql.includes("INSERT INTO")) {
      const [team_id, enterprise_id, bot_token, bot_id, bot_user_id, app_id] =
        params as [string, string, string, string, string, string];
      rows.set(key, {
        team_id,
        enterprise_id,
        bot_token,
        bot_id,
        bot_user_id,
        app_id,
      });
    } else if (sql.trimStart().startsWith("SELECT")) {
      const matches = sql.includes("AND enterprise_id = $2")
        ? [rows.get(key)].filter((row) => row !== undefined)
        : [...rows.values()]
            .filter((row) => row.team_id === params[0])
            .sort(
              (a, b) =>
                Number(b.enterprise_id === params[1]) -
                Number(a.enterprise_id === params[1]),
            );
      return Promise.resolve({ rows: matches.slice(0, 1) });
    } else if (sql.trimStart().startsWith("DELETE") && params.length > 0) {
      rows.delete(key);
    }
    return Promise.resolve({ rows: [] });
  };
  class Pool {
    connect() {
      return Promise.resolve({ query, release: () => undefined });
    }
    end() {
      return Promise.resolve();
    }
  }
  return { Pool };
});

const callOutMock = vi.hoisted(() => vi.fn());
vi.mock("../src/callOut.js", () => ({ callOut: callOutMock }));

const { createApp, getGlobalInstallationStore } = await import("../src/app.js");

const oauthConfig: Config = {
  slackSigningSecret: "test-signing-secret",
  port: 3000,
  triggerEmoji: "meat_proxy",
  databaseSchema: "meatproxybot_test",
  clientId: "client-id",
  clientSecret: "client-secret",
  stateSecret: "state-secret",
  databaseUrl: "postgres://unused",
  encryptionKey: Buffer.alloc(32, 1).toString("base64"),
  publicBaseUrl: "https://example.com",
};

/** An Events API envelope as Slack posts it for a reaction in team `teamId`. */
function reactionEnvelope(teamId: string, enterpriseId: string | null = null) {
  return {
    token: "verification-token",
    team_id: teamId,
    ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
    context_team_id: teamId,
    context_enterprise_id: enterpriseId,
    api_app_id: "A1",
    event: {
      type: "reaction_added",
      user: "UREACTOR",
      reaction: "meat_proxy",
      item: { type: "message", channel: "C1", ts: "1700000000.000100" },
      item_user: "UAUTHOR",
      event_ts: "1700000001.000200",
    },
    type: "event_callback",
    event_id: "Ev1",
    event_time: 1700000001,
    authorizations: [
      {
        enterprise_id: enterpriseId,
        team_id: teamId,
        user_id: "UBOT",
        is_bot: true,
        is_enterprise_install: false,
      },
    ],
    is_ext_shared_channel: false,
    event_context: "4-eyJldCI6InJlYWN0aW9uX2FkZGVkIn0",
  };
}

async function installTeam(
  teamId: string,
  botToken: string,
  botUserId: string,
) {
  const store = getGlobalInstallationStore();
  if (!store) throw new Error("expected an installation store in OAuth mode");
  await store.storeInstallation({
    team: { id: teamId },
    enterprise: undefined,
    user: { token: undefined, scopes: undefined, id: "UINSTALLER" },
    bot: { token: botToken, scopes: [], id: "", userId: botUserId },
    appId: "A1",
    isEnterpriseInstall: false,
    authVersion: "v2",
  });
}

afterEach(() => {
  rows.clear();
  callOutMock.mockReset();
});

describe("OAuth mode authorization", () => {
  it.each([
    ["without SLACK_BOT_TOKEN", oauthConfig],
    ["with SLACK_BOT_TOKEN", { ...oauthConfig, slackBotToken: "xoxb-legacy" }],
  ])(
    "gives a reaction handler its own team's bot token (%s)",
    async (_label, config) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const app = await createApp(config, {
        logLevel: LogLevel.ERROR,
        tokenVerificationEnabled: false,
      });
      await installTeam("T1", "xoxb-team-one", "UBOT1");
      await installTeam("T2", "xoxb-team-two", "UBOT2");
      callOutMock.mockResolvedValue({ status: "posted" });

      await app.processEvent({
        body: reactionEnvelope("T2"),
        ack: () => Promise.resolve(),
      });

      expect(callOutMock).toHaveBeenCalledTimes(1);
      const [args] = callOutMock.mock.calls[0] as [
        { client: { token?: string }; botUserId: string },
      ];
      expect(args.client.token).toBe("xoxb-team-two");
      expect(args.botUserId).toBe("UBOT2");
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("authorizes a workspace in an Enterprise Grid installed without its enterprise", async () => {
    // The OAuth redirect stores enterprise_id as '', but events from a Grid
    // workspace carry the enterprise in `authorizations`.
    const app = await createApp(oauthConfig, {
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    await installTeam("T1", "xoxb-team-one", "UBOT1");
    callOutMock.mockResolvedValue({ status: "posted" });

    await app.processEvent({
      body: reactionEnvelope("T1", "E1"),
      ack: () => Promise.resolve(),
    });

    expect(callOutMock).toHaveBeenCalledTimes(1);
    const [args] = callOutMock.mock.calls[0] as [
      { client: { token?: string } },
    ];
    expect(args.client.token).toBe("xoxb-team-one");
  });

  it("drops events from a team with no installation", async () => {
    const app = await createApp(oauthConfig, {
      logLevel: LogLevel.ERROR,
      tokenVerificationEnabled: false,
    });
    app.error(() => Promise.resolve());
    await installTeam("T1", "xoxb-team-one", "UBOT1");

    await app.processEvent({
      body: reactionEnvelope("T9"),
      ack: () => Promise.resolve(),
    });

    expect(callOutMock).not.toHaveBeenCalled();
  });
});
