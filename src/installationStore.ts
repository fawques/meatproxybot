import { Pool } from "pg";

export interface InstallationQuery {
  teamId: string;
  isEnterpriseInstall: boolean;
  enterpriseId?: string;
}

export interface PostgresInstallationStoreOptions {
  databaseUrl: string;
  schema: string;
}

interface StoredInstallation {
  team_id: string;
  enterprise_id: string | null;
  bot_token: string;
  bot_id: string | null;
  bot_user_id: string | null;
  app_id: string | null;
}

export class PostgresInstallationStore {
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
    try {
      await client.query(`
        CREATE SCHEMA IF NOT EXISTS "${this.schema}";

        CREATE TABLE IF NOT EXISTS "${this.schema}".installations (
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

        CREATE INDEX IF NOT EXISTS idx_installations_team_id
          ON "${this.schema}".installations(team_id);
        CREATE INDEX IF NOT EXISTS idx_installations_team_enterprise
          ON "${this.schema}".installations(team_id, enterprise_id);
      `);
    } finally {
      client.release();
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
      const enterpriseId = (enterprise?.id as string | undefined) ?? null;
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
        botToken,
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
      let sql = `SELECT * FROM "${this.schema}".installations WHERE team_id = $1`;
      const params: (string | null)[] = [query.teamId];

      if (query.enterpriseId) {
        sql += ` AND enterprise_id = $2`;
        params.push(query.enterpriseId);
      } else {
        sql += ` AND enterprise_id IS NULL`;
      }

      const result = await client.query(sql, params);

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
          token: row.bot_token,
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
      let sql = `DELETE FROM "${this.schema}".installations WHERE team_id = $1`;
      const params: (string | null)[] = [query.teamId];

      // A workspace install is identified by its team alone: the OAuth
      // redirect saves enterprise_id as NULL even inside an Enterprise Grid,
      // so filtering on it would leave the bot token behind.
      if (query.isEnterpriseInstall && query.enterpriseId) {
        sql += ` AND enterprise_id = $2`;
        params.push(query.enterpriseId);
      }

      await client.query(sql, params);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
