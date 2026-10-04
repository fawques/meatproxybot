import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresInstallationStore } from "../src/installationStore.js";
import {
  deriveInvokerHashKey,
  formatWeeklyUsage,
  hashInvoker,
  weeklyUsage,
  type UsageEvent,
} from "../src/usage.js";

const key = Buffer.alloc(32, 1);

describe("hashInvoker", () => {
  const hashKey = deriveInvokerHashKey(key);

  it("is stable for the same workspace and user", () => {
    expect(hashInvoker(hashKey, "T1", "U1")).toBe(
      hashInvoker(hashKey, "T1", "U1"),
    );
  });

  it("never contains the raw user ID", () => {
    expect(hashInvoker(hashKey, "T1", "U1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs per workspace and per key", () => {
    const hash = hashInvoker(hashKey, "T1", "U1");
    expect(hashInvoker(hashKey, "T2", "U1")).not.toBe(hash);
    expect(
      hashInvoker(deriveInvokerHashKey(Buffer.alloc(32, 2)), "T1", "U1"),
    ).not.toBe(hash);
  });

  it("does not use the token encryption key itself", () => {
    expect(deriveInvokerHashKey(key).equals(key)).toBe(false);
  });
});

describe("formatWeeklyUsage", () => {
  it("prints workspaces and invokers against the Marketplace minimum", () => {
    const text = formatWeeklyUsage({
      activeWorkspaces: 3,
      activeUsers: 12,
      callouts: 40,
      since: new Date("2026-09-27T00:00:00Z"),
    });
    expect(text).toBe(
      [
        "Last 7 days (since 2026-09-27T00:00:00.000Z):",
        "  Active workspaces: 3 (Marketplace needs 10)",
        "  Distinct invokers: 12 (meets the Marketplace minimum)",
        "  Callouts: 40",
      ].join("\n"),
    );
  });
});

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides
// one); skipped otherwise. Each test gets its own schema.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("usage tracking in Postgres", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  let schema: string;
  let store: PostgresInstallationStore;

  function event(teamId: string, invoker: string): UsageEvent {
    return { teamId, invoker, trigger: "reaction", status: "posted" };
  }

  async function usageRows() {
    const result = await admin.query(
      `SELECT team_id, trigger, status, invoker_hash
       FROM "${schema}".usage_events ORDER BY id`,
    );
    return result.rows as {
      team_id: string;
      trigger: string;
      status: string;
      invoker_hash: string;
    }[];
  }

  async function backdate(days: number) {
    await admin.query(
      `UPDATE "${schema}".usage_events
       SET created_at = now() - make_interval(days => $1)`,
      [days],
    );
  }

  beforeEach(async () => {
    schema = `test_${randomUUID().replaceAll("-", "")}`;
    store = new PostgresInstallationStore({
      databaseUrl: databaseUrl as string,
      schema,
      encryptionKey: key.toString("base64"),
    });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await admin.end();
  });

  it("stores team, trigger, status and a hashed invoker", async () => {
    await store.recordUsage({
      teamId: "T1",
      invoker: "U1",
      trigger: "command",
      status: "error",
    });
    const rows = await usageRows();
    expect(rows).toEqual([
      {
        team_id: "T1",
        trigger: "command",
        status: "error",
        invoker_hash: hashInvoker(deriveInvokerHashKey(key), "T1", "U1"),
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("U1");
  });

  it("counts active workspaces and distinct invokers", async () => {
    await store.recordUsage(event("T1", "U1"));
    await store.recordUsage(event("T1", "U1"));
    await store.recordUsage(event("T1", "U2"));
    await store.recordUsage(event("T2", "U1"));

    expect(await weeklyUsage(admin, schema)).toMatchObject({
      activeWorkspaces: 2,
      activeUsers: 3,
      callouts: 4,
    });
  });

  it("only counts the last 7 days", async () => {
    await store.recordUsage(event("T1", "U1"));
    await backdate(8);
    await store.recordUsage(event("T2", "U2"));

    expect(await weeklyUsage(admin, schema)).toMatchObject({
      activeWorkspaces: 1,
      activeUsers: 1,
      callouts: 1,
    });
  });

  it("prunes rows older than 30 days", async () => {
    await store.recordUsage(event("T1", "U1"));
    await backdate(31);
    await store.recordUsage(event("T2", "U2"));

    expect((await usageRows()).map((row) => row.team_id)).toEqual(["T2"]);
  });

  it("prunes rows older than 30 days on startup", async () => {
    await store.recordUsage(event("T1", "U1"));
    await backdate(31);
    await store.init();

    expect(await usageRows()).toHaveLength(0);
  });

  it("deletes the team's usage rows with its installation", async () => {
    await store.storeInstallation({
      team: { id: "T1" },
      enterprise: undefined,
      user: { token: undefined, scopes: undefined, id: "U0" },
      bot: { id: "B1", token: "xoxb-1", userId: "UB", scopes: [] },
      appId: "A1",
      isEnterpriseInstall: false,
      authVersion: "v2",
    });
    await store.recordUsage(event("T1", "U1"));
    await store.recordUsage(event("T2", "U2"));

    await store.deleteInstallation({
      teamId: "T1",
      enterpriseId: undefined,
      isEnterpriseInstall: false,
    });

    expect((await usageRows()).map((row) => row.team_id)).toEqual(["T2"]);
    const installs = await admin.query(
      `SELECT 1 FROM "${schema}".installations WHERE team_id = 'T1'`,
    );
    expect(installs.rows).toHaveLength(0);
  });

  it("creates the usage table on an existing install", async () => {
    await admin.query(`DROP TABLE "${schema}".usage_events`);
    await store.init();
    await store.recordUsage(event("T1", "U1"));
    expect(await usageRows()).toHaveLength(1);
  });
});
