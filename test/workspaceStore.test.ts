import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryWorkspaceStore,
  PostgresWorkspaceStore,
} from "../src/workspaceStore.js";

describe("InMemoryWorkspaceStore", () => {
  it("stores and retrieves trigger emoji per workspace", async () => {
    const store = new InMemoryWorkspaceStore();
    await store.setTriggerEmoji("T123", "meat_proxy");
    expect(await store.getTriggerEmoji("T123")).toBe("meat_proxy");
  });

  it("returns undefined for unconfigured workspaces", async () => {
    const store = new InMemoryWorkspaceStore();
    expect(await store.getTriggerEmoji("T999")).toBeUndefined();
  });

  it("allows different workspaces to have different emoji", async () => {
    const store = new InMemoryWorkspaceStore();
    await store.setTriggerEmoji("T123", "meat_proxy");
    await store.setTriggerEmoji("T456", "robot_face");
    expect(await store.getTriggerEmoji("T123")).toBe("meat_proxy");
    expect(await store.getTriggerEmoji("T456")).toBe("robot_face");
  });

  it("clears workspace configuration", async () => {
    const store = new InMemoryWorkspaceStore();
    await store.setTriggerEmoji("T123", "meat_proxy");
    await store.clearTriggerEmoji("T123");
    expect(await store.getTriggerEmoji("T123")).toBeUndefined();
  });

  it("updates existing workspace configuration", async () => {
    const store = new InMemoryWorkspaceStore();
    await store.setTriggerEmoji("T123", "meat_proxy");
    await store.setTriggerEmoji("T123", "robot_face");
    expect(await store.getTriggerEmoji("T123")).toBe("robot_face");
  });

  it("deletes a workspace", async () => {
    const store = new InMemoryWorkspaceStore();
    await store.setTriggerEmoji("T123", "robot_face");
    await store.deleteWorkspace("T123");
    expect(await store.getTriggerEmoji("T123")).toBeUndefined();
  });
});

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides
// one); skipped otherwise. Each test gets its own schema.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgresWorkspaceStore", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  let schema: string;
  let stores: PostgresWorkspaceStore[];

  async function openStore(): Promise<PostgresWorkspaceStore> {
    const store = new PostgresWorkspaceStore({
      databaseUrl: databaseUrl as string,
      schema,
    });
    stores.push(store);
    await store.init();
    return store;
  }

  async function rows(teamId: string) {
    const result = await admin.query(
      `SELECT * FROM "${schema}".workspace_settings WHERE team_id = $1`,
      [teamId],
    );
    return result.rows as { trigger_emoji: string | null }[];
  }

  beforeEach(() => {
    schema = `test_${randomUUID().replaceAll("-", "")}`;
    stores = [];
  });

  afterEach(async () => {
    await Promise.all(stores.map((store) => store.close()));
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await admin.end();
  });

  it("returns undefined for an unconfigured workspace", async () => {
    const store = await openStore();
    expect(await store.getTriggerEmoji("T1")).toBeUndefined();
  });

  it("keeps the setting across a restart", async () => {
    const first = await openStore();
    await first.setTriggerEmoji("T1", "robot_face");
    await first.close();
    stores = [];

    const second = await openStore();
    expect(await second.getTriggerEmoji("T1")).toBe("robot_face");
  });

  it("keeps one row per workspace and isolates workspaces", async () => {
    const store = await openStore();
    await store.setTriggerEmoji("T1", "robot_face");
    await store.setTriggerEmoji("T1", "tada");
    await store.setTriggerEmoji("T2", "eyes");

    expect(await rows("T1")).toHaveLength(1);
    expect(await store.getTriggerEmoji("T1")).toBe("tada");
    expect(await store.getTriggerEmoji("T2")).toBe("eyes");
  });

  it("clears the trigger emoji", async () => {
    const store = await openStore();
    await store.setTriggerEmoji("T1", "robot_face");
    await store.clearTriggerEmoji("T1");
    expect(await store.getTriggerEmoji("T1")).toBeUndefined();
    // Clearing a workspace that never set one is fine too.
    await expect(store.clearTriggerEmoji("T2")).resolves.toBeUndefined();
  });

  it("deletes the workspace's row", async () => {
    const store = await openStore();
    await store.setTriggerEmoji("T1", "robot_face");
    await store.setTriggerEmoji("T2", "tada");
    await store.deleteWorkspace("T1");
    expect(await rows("T1")).toHaveLength(0);
    expect(await store.getTriggerEmoji("T2")).toBe("tada");
  });

  it("creates the table next to an existing installations table", async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`CREATE TABLE "${schema}".installations (id SERIAL)`);
    const store = await openStore();
    await store.setTriggerEmoji("T1", "robot_face");
    expect(await rows("T1")).toHaveLength(1);
  });
});
