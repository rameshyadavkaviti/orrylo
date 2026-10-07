import { resolve } from "node:path";

import { createDatabaseClient } from "../lib/server/persistence/database";
import { migrateDatabase } from "../lib/server/persistence/migrations";

const EXPECTED_TABLES = [
  "auth_challenges",
  "auth_sessions",
  "workflow_intents",
  "audit_chain_heads",
  "audit_events",
  "eligibility_records",
  "reward_records",
  "protected_operation_intents",
] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const sql = createDatabaseClient(databaseUrl);

  try {
    await migrateDatabase(sql, resolve(process.cwd(), "db/migrations"));

    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ANY(${EXPECTED_TABLES})
    `;
    const found = new Set(rows.map((row) => row.table_name));
    const missing = EXPECTED_TABLES.filter((name) => !found.has(name));

    if (missing.length > 0) {
      throw new Error(`Missing database tables: ${missing.join(", ")}`);
    }

    process.stdout.write("Database schema verified.\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
