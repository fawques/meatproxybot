import type {
  Installation,
  InstallationQuery,
  InstallationStore,
} from "@slack/bolt";
import { Pool } from "pg";

export interface PostgresInstallationStoreOptions {
  databaseUrl: string;
  schema: string;
}

interface StoredInstallation {
  team_id: string;
  enterprise_id: string;
  bot_token: string;
  bot_id: string | null;
  bot_user_id: string | null;
  app_id: string | null;
}

export class PostgresInstallationStore implements InstallationStore {
  private pool: Pool;
  private schema: string;

  constructor(options: PostgresInstallationStoreOptions) {
    this.schema = options.schema;
    this.pool = new Pool({
      connectionString: options.databaseUrl,
      min: 2,
      max: 10,
    });
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    const table = `"${this.schema}".installations`;
    try {
      await client.query("BEGIN");
      // enterprise_id is '' (not NULL) for ordinary workspaces: Postgres treats
      // NULLs as distinct, so UNIQUE(team_id, enterprise_id) would not hold.
      await client.query(`
        CREATE SCHEMA IF NOT EXISTS "${this.schema}";

        CREATE TABLE IF NOT EXISTS ${table} (
          id SERIAL PRIMARY KEY,
          team_id VARCHAR(255) NOT NULL,
          enterprise_id VARCHAR(255) NOT NULL DEFAULT '',
          bot_token VARCHAR(255) NOT NULL,
          bot_id VARCHAR(255),
          bot_user_id VARCHAR(255),
          app_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(team_id, enterprise_id)
        );

        CREATE INDEX IF NOT EXISTS idx_installations_team_id
          ON ${table}(team_id);
        CREATE INDEX IF NOT EXISTS idx_installations_team_enterprise
          ON ${table}(team_id, enterprise_id);
      `);
      // Migrate tables created with a nullable enterprise_id: drop the
      // duplicate rows reinstalls left behind (keeping the newest per team),
      // then replace NULL with ''. Both are no-ops once migrated.
      await client.query(`
        DELETE FROM ${table}
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY team_id, COALESCE(enterprise_id, '')
              ORDER BY updated_at DESC NULLS LAST, id DESC
            ) AS rank
            FROM ${table}
          ) ranked
          WHERE rank > 1
        );

        UPDATE ${table} SET enterprise_id = '' WHERE enterprise_id IS NULL;

        ALTER TABLE ${table}
          ALTER COLUMN enterprise_id SET DEFAULT '',
          ALTER COLUMN enterprise_id SET NOT NULL;
      `);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async storeInstallation(installation: Installation): Promise<void> {
    const teamId = installation.team?.id;
    const enterpriseId = installation.enterprise?.id ?? "";
    const bot = installation.bot;
    if (!teamId || !bot?.token) {
      throw new Error(
        "Missing required installation fields: team_id and bot_token",
      );
    }

    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO "${this.schema}".installations
          (team_id, enterprise_id, bot_token, bot_id, bot_user_id, app_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        ON CONFLICT (team_id, enterprise_id)
        DO UPDATE SET
          bot_token = $3,
          bot_id = $4,
          bot_user_id = $5,
          app_id = $6,
          updated_at = CURRENT_TIMESTAMP
      `;
      await client.query(query, [
        teamId,
        enterpriseId,
        bot.token,
        bot.id || null,
        bot.userId || null,
        installation.appId ?? null,
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Returns the workspace's installation. Throws when there is none, which
   * Bolt reports as a failed authorization.
   */
  async fetchInstallation(
    query: InstallationQuery<boolean>,
  ): Promise<Installation<"v2", false>> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM "${this.schema}".installations
         WHERE team_id = $1 AND enterprise_id = $2
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [query.teamId, query.enterpriseId ?? ""],
      );

      const row = result.rows[0] as StoredInstallation | undefined;
      if (!row) {
        throw new Error(
          `No installation for team ${String(query.teamId)} (enterprise ${query.enterpriseId ?? "none"})`,
        );
      }

      return {
        team: { id: row.team_id },
        enterprise: row.enterprise_id ? { id: row.enterprise_id } : undefined,
        user: { token: undefined, scopes: undefined, id: "" },
        bot: {
          token: row.bot_token,
          scopes: [],
          id: row.bot_id ?? "",
          userId: row.bot_user_id ?? "",
        },
        ...(row.app_id ? { appId: row.app_id } : {}),
        tokenType: "bot",
        isEnterpriseInstall: false,
        authVersion: "v2",
      };
    } finally {
      client.release();
    }
  }

  async deleteInstallation(query: InstallationQuery<boolean>): Promise<void> {
    const client = await this.pool.connect();
    try {
      // A workspace install is identified by its team alone: the OAuth
      // redirect saves enterprise_id as '' even inside an Enterprise Grid,
      // so matching on the enterprise would leave the bot token behind.
      if (query.isEnterpriseInstall) {
        await client.query(
          `DELETE FROM "${this.schema}".installations
           WHERE team_id = $1 AND enterprise_id = $2`,
          [query.teamId, query.enterpriseId ?? ""],
        );
      } else {
        await client.query(
          `DELETE FROM "${this.schema}".installations WHERE team_id = $1`,
          [query.teamId],
        );
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
