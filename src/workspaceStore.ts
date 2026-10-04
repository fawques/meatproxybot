import { Pool } from "pg";

/**
 * Manages per-workspace trigger emoji configuration.
 * Workspaces can configure their own trigger emoji independently.
 */
export interface WorkspaceStore {
  /**
   * Get the trigger emoji for a workspace.
   * Returns undefined if no specific configuration exists.
   */
  getTriggerEmoji(teamId: string): Promise<string | undefined>;

  /**
   * Set the trigger emoji for a workspace.
   */
  setTriggerEmoji(teamId: string, emoji: string): Promise<void>;

  /**
   * Clear the trigger emoji configuration for a workspace.
   */
  clearTriggerEmoji(teamId: string): Promise<void>;

  /**
   * Delete everything stored for a workspace, when it uninstalls the app.
   */
  deleteWorkspace(teamId: string): Promise<void>;
}

/**
 * In-memory workspace store for per-workspace configuration.
 * Configuration is stored in a Map but not persisted to disk.
 */
export class InMemoryWorkspaceStore implements WorkspaceStore {
  private config: Map<string, string> = new Map();

  getTriggerEmoji(teamId: string): Promise<string | undefined> {
    return Promise.resolve(this.config.get(teamId));
  }

  setTriggerEmoji(teamId: string, emoji: string): Promise<void> {
    this.config.set(teamId, emoji);
    return Promise.resolve();
  }

  clearTriggerEmoji(teamId: string): Promise<void> {
    this.config.delete(teamId);
    return Promise.resolve();
  }

  deleteWorkspace(teamId: string): Promise<void> {
    this.config.delete(teamId);
    return Promise.resolve();
  }
}

export interface PostgresWorkspaceStoreOptions {
  databaseUrl: string;
  schema: string;
}

/**
 * Stores per-workspace settings in a `workspace_settings` table, next to
 * `installations` in the same schema. One row per workspace, keyed by team.
 */
export class PostgresWorkspaceStore implements WorkspaceStore {
  private pool: Pool;
  private schema: string;
  private table: string;

  constructor(options: PostgresWorkspaceStoreOptions) {
    this.schema = options.schema;
    this.table = `"${options.schema}".workspace_settings`;
    this.pool = new Pool({
      connectionString: options.databaseUrl,
      max: 5,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS "${this.schema}";

      CREATE TABLE IF NOT EXISTS ${this.table} (
        team_id VARCHAR(255) PRIMARY KEY,
        trigger_emoji VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async getTriggerEmoji(teamId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ trigger_emoji: string | null }>(
      `SELECT trigger_emoji FROM ${this.table} WHERE team_id = $1`,
      [teamId],
    );
    return result.rows[0]?.trigger_emoji ?? undefined;
  }

  async setTriggerEmoji(teamId: string, emoji: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table} (team_id, trigger_emoji, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (team_id)
       DO UPDATE SET trigger_emoji = $2, updated_at = CURRENT_TIMESTAMP`,
      [teamId, emoji],
    );
  }

  async clearTriggerEmoji(teamId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table}
       SET trigger_emoji = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE team_id = $1`,
      [teamId],
    );
  }

  async deleteWorkspace(teamId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE team_id = $1`, [
      teamId,
    ]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
