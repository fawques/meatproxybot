import { Pool, type PoolClient } from "pg";
import {
  TokenDecryptionError,
  decryptToken,
  encryptToken,
  isEncryptedToken,
  parseEncryptionKey,
} from "./tokenCrypto.js";

export interface InstallationQuery {
  teamId: string;
  isEnterpriseInstall: boolean;
  enterpriseId?: string;
}

export interface PostgresInstallationStoreOptions {
  databaseUrl: string;
  schema: string;
  /** INSTALLATION_ENCRYPTION_KEY: 32 bytes, base64. Encrypts bot tokens. */
  encryptionKey: string;
}

interface StoredInstallation {
  team_id: string;
  enterprise_id: string;
  bot_token: string;
  bot_id: string | null;
  bot_user_id: string | null;
  app_id: string | null;
}

export class PostgresInstallationStore {
  private pool: Pool;
  private schema: string;
  private encryptionKey: Buffer;

  constructor(options: PostgresInstallationStoreOptions) {
    this.schema = options.schema;
    this.encryptionKey = parseEncryptionKey(options.encryptionKey);
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
          bot_token TEXT NOT NULL,
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
          ALTER COLUMN enterprise_id SET NOT NULL,
          ALTER COLUMN bot_token TYPE TEXT;
      `);
      await this.encryptStoredTokens(client, table);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Encrypts tokens stored in plain text before encryption existed, and
   * checks every encrypted one decrypts, so a wrong
   * INSTALLATION_ENCRYPTION_KEY stops startup instead of surfacing later as
   * Slack auth failures.
   */
  private async encryptStoredTokens(
    client: PoolClient,
    table: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT id, team_id, enterprise_id, bot_token FROM ${table}`,
    );
    for (const row of result.rows as (StoredInstallation & { id: number })[]) {
      if (isEncryptedToken(row.bot_token)) {
        this.decrypt(row);
      } else {
        await client.query(`UPDATE ${table} SET bot_token = $1 WHERE id = $2`, [
          encryptToken(row.bot_token, this.encryptionKey),
          row.id,
        ]);
      }
    }
  }

  private decrypt(row: StoredInstallation): string {
    // Tolerate a plain-text token that has not been migrated yet.
    if (!isEncryptedToken(row.bot_token)) {
      return row.bot_token;
    }
    try {
      return decryptToken(row.bot_token, this.encryptionKey);
    } catch (error) {
      const workspace = row.enterprise_id
        ? `${row.team_id} (enterprise ${row.enterprise_id})`
        : row.team_id;
      throw new TokenDecryptionError(
        `Workspace ${workspace}: ${(error as Error).message}`,
      );
    }
  }

  async save(installation: Record<string, unknown>): Promise<void> {
    const client = await this.pool.connect();
    try {
      const team = installation.team as Record<string, unknown> | undefined;
      const enterprise = installation.enterprise as
        Record<string, unknown> | undefined;
      const bot = installation.bot as Record<string, unknown> | undefined;
      const teamId = team?.id as string | undefined;
      const enterpriseId = (enterprise?.id as string | undefined) ?? "";
      const botToken = bot?.token as string | undefined;
      const botId = bot?.id as string | undefined;
      const botUserId = installation.bot_user_id as string | undefined;
      const appId = installation.app_id as string | undefined;

      if (!teamId || !botToken) {
        throw new Error(
          "Missing required installation fields: team_id and bot_token",
        );
      }

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
        encryptToken(botToken, this.encryptionKey),
        botId,
        botUserId,
        appId,
      ]);
    } finally {
      client.release();
    }
  }

  async find(
    query: InstallationQuery,
  ): Promise<Record<string, unknown> | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM "${this.schema}".installations
         WHERE team_id = $1 AND enterprise_id = $2
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [query.teamId, query.enterpriseId ?? ""],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as StoredInstallation;
      return {
        app_id: row.app_id,
        enterprise: row.enterprise_id ? { id: row.enterprise_id } : undefined,
        team: { id: row.team_id },
        bot: {
          id: row.bot_id,
          token: this.decrypt(row),
          scopes: [],
        },
        bot_user_id: row.bot_user_id,
        user_id: undefined,
        incoming_webhook_url: undefined,
        token_type: "bot",
        is_enterprise_install: !!row.enterprise_id,
      };
    } finally {
      client.release();
    }
  }

  async delete(query: InstallationQuery): Promise<void> {
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
