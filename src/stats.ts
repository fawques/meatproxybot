import { Pool } from "pg";
import { DEFAULT_DATABASE_SCHEMA } from "./config.js";
import { formatWeeklyUsage, weeklyUsage } from "./usage.js";

/**
 * Prints the weekly active workspaces and invokers, for Slack Marketplace
 * eligibility. Reads only DATABASE_URL and DATABASE_SCHEMA.
 *
 * Usage: npm run stats (runs the build in dist/, so `npm run build` first
 * outside the production image)
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is missing");
    process.exitCode = 1;
    return;
  }
  const schema = process.env.DATABASE_SCHEMA?.trim() || DEFAULT_DATABASE_SCHEMA;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    console.log(formatWeeklyUsage(await weeklyUsage(pool, schema)));
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(
    "Failed to read usage stats:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
