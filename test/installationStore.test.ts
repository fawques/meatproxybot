import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn<(sql: string, params?: unknown[]) => Promise<unknown>>();

// Capture the SQL the store sends instead of talking to a database.
vi.mock("pg", () => ({
  Pool: class {
    connect = () => Promise.resolve({ query, release: () => undefined });
    end = () => Promise.resolve();
  },
}));

const { PostgresInstallationStore } =
  await import("../src/installationStore.js");

function lastQuery(): { sql: string; params: unknown[] | undefined } {
  const call = query.mock.calls.at(-1);
  if (!call) {
    throw new Error("no query was sent");
  }
  return { sql: call[0].replace(/\s+/g, " ").trim(), params: call[1] };
}

describe("PostgresInstallationStore.delete", () => {
  const store = new PostgresInstallationStore({
    databaseUrl: "postgres://localhost/test",
    schema: "meatproxybot_test",
  });

  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it("deletes every row for a workspace install by team", async () => {
    await store.delete({ teamId: "T123", isEnterpriseInstall: false });
    expect(lastQuery()).toEqual({
      sql: 'DELETE FROM "meatproxybot_test".installations WHERE team_id = $1',
      params: ["T123"],
    });
  });

  it("ignores the enterprise for a workspace install in an Enterprise Grid", async () => {
    // The OAuth redirect saves enterprise_id as NULL, so filtering on the
    // enterprise would miss the row and leave the bot token behind.
    await store.delete({
      teamId: "T123",
      enterpriseId: "E123",
      isEnterpriseInstall: false,
    });
    expect(lastQuery()).toEqual({
      sql: 'DELETE FROM "meatproxybot_test".installations WHERE team_id = $1',
      params: ["T123"],
    });
  });

  it("matches the enterprise for an org-wide install", async () => {
    await store.delete({
      teamId: "T123",
      enterpriseId: "E123",
      isEnterpriseInstall: true,
    });
    expect(lastQuery()).toEqual({
      sql: 'DELETE FROM "meatproxybot_test".installations WHERE team_id = $1 AND enterprise_id = $2',
      params: ["T123", "E123"],
    });
  });
});
