import { randomUUID } from "node:crypto";
import type { Installation } from "@slack/bolt";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresInstallationStore } from "../src/installationStore.js";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides
// one); skipped otherwise. Each test gets its own schema.
const databaseUrl = process.env.TEST_DATABASE_URL;

function installation(
  teamId: string,
  token: string,
  enterpriseId?: string,
): Installation<"v2", false> {
  return {
    team: { id: teamId },
    enterprise: enterpriseId ? { id: enterpriseId } : undefined,
    user: { token: undefined, scopes: undefined, id: "U0" },
    bot: { id: "B1", token, userId: "U1", scopes: [] },
    appId: "A1",
    isEnterpriseInstall: false,
    authVersion: "v2",
  };
}

describe.skipIf(!databaseUrl)("PostgresInstallationStore", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  let schema: string;
  let store: PostgresInstallationStore;

  async function rows(teamId: string) {
    const result = await admin.query(
      `SELECT * FROM "${schema}".installations WHERE team_id = $1`,
      [teamId],
    );
    return result.rows as { bot_token: string; enterprise_id: string }[];
  }

  beforeEach(() => {
    schema = `test_${randomUUID().replaceAll("-", "")}`;
    store = new PostgresInstallationStore({
      databaseUrl: databaseUrl as string,
      schema,
    });
  });

  afterEach(async () => {
    await store.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await admin.end();
  });

  it("keeps one row per workspace when it is saved twice", async () => {
    await store.init();
    await store.storeInstallation(installation("T1", "xoxb-old"));
    await store.storeInstallation(installation("T1", "xoxb-new"));

    const stored = await rows("T1");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.bot_token).toBe("xoxb-new");

    const found = await store.fetchInstallation({
      teamId: "T1",
      enterpriseId: undefined,
      isEnterpriseInstall: false,
    });
    expect(found.bot).toEqual({
      token: "xoxb-new",
      id: "B1",
      userId: "U1",
      scopes: [],
    });
    expect(found.enterprise).toBeUndefined();
    expect(found.isEnterpriseInstall).toBe(false);
    expect(found.appId).toBe("A1");
  });

  it("keeps one row per enterprise workspace when it is saved twice", async () => {
    await store.init();
    await store.storeInstallation(installation("T1", "xoxb-old", "E1"));
    await store.storeInstallation(installation("T1", "xoxb-new", "E1"));

    expect(await rows("T1")).toHaveLength(1);
    const found = await store.fetchInstallation({
      teamId: "T1",
      isEnterpriseInstall: false,
      enterpriseId: "E1",
    });
    expect(found.bot).toMatchObject({ token: "xoxb-new" });
    expect(found.enterprise).toEqual({ id: "E1" });
  });

  it("deletes a non-enterprise installation", async () => {
    await store.init();
    await store.storeInstallation(installation("T1", "xoxb-1"));
    await store.deleteInstallation({
      teamId: "T1",
      enterpriseId: undefined,
      isEnterpriseInstall: false,
    });

    expect(await rows("T1")).toHaveLength(0);
    await expect(
      store.fetchInstallation({
        teamId: "T1",
        enterpriseId: undefined,
        isEnterpriseInstall: false,
      }),
    ).rejects.toThrow("No installation for team T1");
  });

  it("migrates a table with duplicate rows to one row per team", async () => {
    // The table as created before the fix, with the duplicates reinstalls left.
    await admin.query(`
      CREATE SCHEMA "${schema}";
      CREATE TABLE "${schema}".installations (
        id SERIAL PRIMARY KEY,
        team_id VARCHAR(255) NOT NULL,
        enterprise_id VARCHAR(255),
        bot_token VARCHAR(255) NOT NULL,
        bot_id VARCHAR(255),
        bot_user_id VARCHAR(255),
        app_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(team_id, enterprise_id)
      );
      INSERT INTO "${schema}".installations (team_id, enterprise_id, bot_token, updated_at) VALUES
        ('T1', NULL, 'xoxb-t1-old', '2026-01-01'),
        ('T1', NULL, 'xoxb-t1-new', '2026-03-01'),
        ('T1', NULL, 'xoxb-t1-mid', '2026-02-01'),
        ('T2', NULL, 'xoxb-t2', '2026-01-01'),
        ('T3', 'E1', 'xoxb-t3', '2026-01-01');
    `);

    await store.init();
    // Running it again must be a no-op.
    await store.init();

    const t1 = await rows("T1");
    expect(t1).toHaveLength(1);
    expect(t1[0]?.bot_token).toBe("xoxb-t1-new");
    expect(await rows("T2")).toHaveLength(1);
    expect(await rows("T3")).toHaveLength(1);

    // The constraint now holds, so a reinstall updates the surviving row.
    await store.storeInstallation(installation("T1", "xoxb-t1-reinstall"));
    const after = await rows("T1");
    expect(after).toHaveLength(1);
    expect(after[0]?.bot_token).toBe("xoxb-t1-reinstall");
    const t3 = await store.fetchInstallation({
      teamId: "T3",
      isEnterpriseInstall: false,
      enterpriseId: "E1",
    });
    expect(t3.bot).toMatchObject({ token: "xoxb-t3" });
  });
});
