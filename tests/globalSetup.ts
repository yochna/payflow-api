import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { testDbUrl } from "./helpers/config";

/**
 * Runs once before the whole suite:
 *  1. Creates the test database if it does not exist.
 *  2. Resets it and applies schema.sql so every run starts clean.
 */
export default async function globalSetup(): Promise<void> {
  const targetUrl = testDbUrl();

  // Connect to the maintenance database to create the target DB if needed.
  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = "/postgres";
  const dbName = targetUrl.startsWith("postgres")
    ? new URL(targetUrl).pathname.slice(1)
    : "";

  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Invalid test database name derived from ${targetUrl}`);
  }

  const admin = new Pool({ connectionString: adminUrl.toString() });
  try {
    await admin.query("SELECT 1");
  } catch {
    throw new Error(
      `Could not connect to Postgres at ${targetUrl}.\n` +
        "Start a local database with:  docker compose up -d db\n" +
        "or set DATABASE_URL_TEST to an existing database."
    );
  }

  try {
    await admin.query(`CREATE DATABASE ${dbName}`);
  } catch (err: any) {
    // 42P04 = duplicate_database — fine, it already exists.
    if (err?.code !== "42P04") throw err;
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: targetUrl });
  await pool.query(
    "DROP TABLE IF EXISTS merchants, customers, payments, settlements, refunds, disputes, webhook_events, audit_logs CASCADE"
  );
  const schema = readFileSync(join(process.cwd(), "schema.sql"), "utf8");
  await pool.query(schema);
  await pool.end();
}