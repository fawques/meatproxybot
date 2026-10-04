import { createHmac, hkdfSync } from "node:crypto";
import type { CallOutResult, CallOutTrigger } from "./callOut.js";

/** The slice of a pg Pool or PoolClient the usage queries need. */
export interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

/** One callout, as callOut reports it for usage tracking. */
export interface UsageEvent {
  teamId: string;
  trigger: CallOutTrigger;
  status: CallOutResult["status"];
  /** The raw Slack user ID. Hashed before it is stored. */
  invoker: string;
}

export interface WeeklyUsage {
  /** Workspaces with at least one callout in the window. */
  activeWorkspaces: number;
  /** Distinct (workspace, invoker) pairs in the window. */
  activeUsers: number;
  callouts: number;
  since: Date;
}

/** Usage rows older than this are pruned. Mirrored in the privacy policy. */
export const USAGE_RETENTION_DAYS = 30;
export const STATS_WINDOW_DAYS = 7;

/**
 * Derives the invoker-hash key from INSTALLATION_ENCRYPTION_KEY, so usage
 * tracking needs no extra secret but never reuses the token key itself.
 */
export function deriveInvokerHashKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(
    hkdfSync("sha256", encryptionKey, "", "meatproxybot usage invoker v1", 32),
  );
}

/**
 * Pseudonymises an invoker. A keyed HMAC rather than a plain hash: Slack user
 * IDs are few enough to enumerate, so an unkeyed hash would not hide them.
 */
export function hashInvoker(
  key: Buffer,
  teamId: string,
  userId: string,
): string {
  return createHmac("sha256", key).update(`${teamId}:${userId}`).digest("hex");
}

export function usageTable(schema: string): string {
  return `"${schema}".usage_events`;
}

/** Creates the usage table. Expects the schema to exist. */
export async function createUsageTable(
  db: Queryable,
  schema: string,
): Promise<void> {
  const table = usageTable(schema);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id BIGSERIAL PRIMARY KEY,
      team_id VARCHAR(255) NOT NULL,
      trigger VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL,
      invoker_hash CHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_usage_events_created_at
      ON ${table}(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_team_id
      ON ${table}(team_id);
  `);
}

/** Deletes usage rows past the retention period. */
export async function pruneUsage(db: Queryable, schema: string): Promise<void> {
  await db.query(
    `DELETE FROM ${usageTable(schema)}
     WHERE created_at < now() - make_interval(days => $1)`,
    [USAGE_RETENTION_DAYS],
  );
}

/** Stores one callout and prunes rows past the retention period. */
export async function insertUsage(
  db: Queryable,
  schema: string,
  hashKey: Buffer,
  event: UsageEvent,
): Promise<void> {
  const table = usageTable(schema);
  await pruneUsage(db, schema);
  await db.query(
    `INSERT INTO ${table} (team_id, trigger, status, invoker_hash)
     VALUES ($1, $2, $3, $4)`,
    [
      event.teamId,
      event.trigger,
      event.status,
      hashInvoker(hashKey, event.teamId, event.invoker),
    ],
  );
}

export async function deleteTeamUsage(
  db: Queryable,
  schema: string,
  teamId: string,
): Promise<void> {
  await db.query(`DELETE FROM ${usageTable(schema)} WHERE team_id = $1`, [
    teamId,
  ]);
}

/** Active workspaces and users over the STATS_WINDOW_DAYS before `now`. */
export async function weeklyUsage(
  db: Queryable,
  schema: string,
  now: Date = new Date(),
): Promise<WeeklyUsage> {
  const since = new Date(now.getTime() - STATS_WINDOW_DAYS * 86_400_000);
  const result = await db.query(
    `SELECT
       COUNT(DISTINCT team_id) AS workspaces,
       COUNT(DISTINCT (team_id, invoker_hash)) AS users,
       COUNT(*) AS callouts
     FROM ${usageTable(schema)}
     WHERE created_at > $1 AND created_at <= $2`,
    [since, now],
  );
  const row = result.rows[0] ?? {};
  return {
    activeWorkspaces: Number(row.workspaces ?? 0),
    activeUsers: Number(row.users ?? 0),
    callouts: Number(row.callouts ?? 0),
    since,
  };
}

/** The Slack Marketplace minimum: 10 active workspaces, 10 weekly users. */
export const MARKETPLACE_MINIMUM = 10;

/** Renders weeklyUsage for `npm run stats`. */
export function formatWeeklyUsage(usage: WeeklyUsage): string {
  const check = (n: number) =>
    n >= MARKETPLACE_MINIMUM
      ? "meets the Marketplace minimum"
      : `Marketplace needs ${String(MARKETPLACE_MINIMUM)}`;
  return [
    `Last ${String(STATS_WINDOW_DAYS)} days (since ${usage.since.toISOString()}):`,
    `  Active workspaces: ${String(usage.activeWorkspaces)} (${check(usage.activeWorkspaces)})`,
    `  Distinct invokers: ${String(usage.activeUsers)} (${check(usage.activeUsers)})`,
    `  Callouts: ${String(usage.callouts)}`,
  ].join("\n");
}
