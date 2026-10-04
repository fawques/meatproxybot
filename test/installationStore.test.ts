import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresInstallationStore } from "../src/installationStore.js";
import { decryptToken, encryptToken } from "../src/tokenCrypto.js";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides
// one); skipped otherwise. Each test gets its own schema.
const databaseUrl = process.env.TEST_DATABASE_URL;
const key = Buffer.alloc(32, 1);
const otherKey = Buffer.alloc(32, 2);

function storeWith(schema: string, encryptionKey: Buffer) {
  return new PostgresInstallationStore({
    databaseUrl: databaseUrl as string,
    schema,
    encryptionKey: encryptionKey.toString("base64"),
  });
}

function installation(teamId: string, token: string, enterpriseId?: string) {
  return {
    team: { id: teamId },
    enterprise: enterpriseId ? { id: enterpriseId } : undefined,
    bot: { id: "B1", token },
    bot_user_id: "U1",
    app_id: "A1",
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

  async function tokens(teamId: string) {
    return (await rows(teamId)).map((row) => {
      expect(row.bot_token).toMatch(/^v1:/);
      return decryptToken(row.bot_token, key);
    });
  }

  beforeEach(() => {
    schema = `test_${randomUUID().replaceAll("-", "")}`;
    store = storeWith(schema, key);
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
    await store.save(installation("T1", "xoxb-old"));
    await store.save(installation("T1", "xoxb-new"));

    expect(await tokens("T1")).toEqual(["xoxb-new"]);

    const found = await store.find({
      teamId: "T1",
      isEnterpriseInstall: false,
    });
    expect(found?.bot).toMatchObject({ token: "xoxb-new" });
    expect(found?.enterprise).toBeUndefined();
    expect(found?.is_enterprise_install).toBe(false);
  });

  it("keeps one row per enterprise workspace when it is saved twice", async () => {
    await store.init();
    await store.save(installation("T1", "xoxb-old", "E1"));
    await store.save(installation("T1", "xoxb-new", "E1"));

    expect(await rows("T1")).toHaveLength(1);
    const found = await store.find({
      teamId: "T1",
      isEnterpriseInstall: false,
      enterpriseId: "E1",
    });
    expect(found?.bot).toMatchObject({ token: "xoxb-new" });
    expect(found?.enterprise).toEqual({ id: "E1" });
  });

  it("deletes a non-enterprise installation", async () => {
    await store.init();
    await store.save(installation("T1", "xoxb-1"));
    await store.delete({ teamId: "T1", isEnterpriseInstall: false });

    expect(await rows("T1")).toHaveLength(0);
    expect(
      await store.find({ teamId: "T1", isEnterpriseInstall: false }),
    ).toBeNull();
  });

  it("deletes a workspace in an Enterprise Grid saved without its enterprise", async () => {
    // The OAuth redirect saves enterprise_id as '' even inside a Grid, but
    // Slack's app_uninstalled envelope carries the enterprise.
    await store.init();
    await store.save(installation("T1", "xoxb-1"));
    await store.delete({
      teamId: "T1",
      enterpriseId: "E1",
      isEnterpriseInstall: false,
    });

    expect(await rows("T1")).toHaveLength(0);
  });

  it("deletes a workspace in an Enterprise Grid saved with its enterprise", async () => {
    await store.init();
    await store.save(installation("T1", "xoxb-1", "E1"));
    await store.delete({
      teamId: "T1",
      enterpriseId: "E1",
      isEnterpriseInstall: false,
    });

    expect(await rows("T1")).toHaveLength(0);
  });

  it("deletes an org-wide install only for its enterprise", async () => {
    await store.init();
    await store.save(installation("T1", "xoxb-e1", "E1"));
    await store.save(installation("T1", "xoxb-e2", "E2"));
    await store.delete({
      teamId: "T1",
      enterpriseId: "E1",
      isEnterpriseInstall: true,
    });

    const left = await rows("T1");
    expect(left).toHaveLength(1);
    expect(left[0]?.enterprise_id).toBe("E2");
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

    expect(await tokens("T1")).toEqual(["xoxb-t1-new"]);
    expect(await rows("T2")).toHaveLength(1);
    expect(await rows("T3")).toHaveLength(1);

    // The constraint now holds, so a reinstall updates the surviving row.
    await store.save(installation("T1", "xoxb-t1-reinstall"));
    expect(await tokens("T1")).toEqual(["xoxb-t1-reinstall"]);
    const t3 = await store.find({
      teamId: "T3",
      isEnterpriseInstall: false,
      enterpriseId: "E1",
    });
    expect(t3?.bot).toMatchObject({ token: "xoxb-t3" });
  });

  it("never stores a plain-text token", async () => {
    await store.init();
    await store.save(installation("T1", "xoxb-secret"));

    const [row] = await rows("T1");
    expect(row?.bot_token).not.toContain("xoxb-");
    expect(row?.bot_token).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
  });

  it("encrypts plain-text tokens left from before encryption", async () => {
    await store.init();
    await admin.query(
      `INSERT INTO "${schema}".installations (team_id, bot_token) VALUES ('T1', 'xoxb-plain')`,
    );

    // Still readable before the migration runs...
    const before = await store.find({
      teamId: "T1",
      isEnterpriseInstall: false,
    });
    expect(before?.bot).toMatchObject({ token: "xoxb-plain" });

    // ...and encrypted by the next startup.
    await store.init();
    expect(await tokens("T1")).toEqual(["xoxb-plain"]);
    const after = await store.find({
      teamId: "T1",
      isEnterpriseInstall: false,
    });
    expect(after?.bot).toMatchObject({ token: "xoxb-plain" });
  });

  it("refuses to start with a key that does not match the stored tokens", async () => {
    await store.init();
    await store.save(installation("T1", "xoxb-secret"));

    const wrong = storeWith(schema, otherKey);
    try {
      await expect(wrong.init()).rejects.toThrow(
        /Workspace T1: .*INSTALLATION_ENCRYPTION_KEY is not the key/,
      );
    } finally {
      await wrong.close();
    }
    // The failed startup changed nothing.
    expect(await tokens("T1")).toEqual(["xoxb-secret"]);
  });

  it("fails loudly when reading a token encrypted with another key", async () => {
    await store.init();
    await admin.query(
      `INSERT INTO "${schema}".installations (team_id, bot_token) VALUES ('T1', $1)`,
      [encryptToken("xoxb-secret", otherKey)],
    );

    await expect(
      store.find({ teamId: "T1", isEnterpriseInstall: false }),
    ).rejects.toThrow(
      /Workspace T1: .*INSTALLATION_ENCRYPTION_KEY is not the key/,
    );
  });
});
