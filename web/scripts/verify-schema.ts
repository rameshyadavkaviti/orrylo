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
  "token_creation_qualifying_events",
] as const;

const EXPECTED_ELIGIBILITY_REWARD_CONSTRAINTS = [
  "eligibility_records_first_token_event_required",
  "eligibility_records_qualifying_event_fk",
  "reward_records_first_token_amount_check",
  "reward_records_first_token_evidence_required",
  "reward_records_qualifying_event_fk",
  "token_creation_qualifying_events_processing_check",
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

    const constraintRows = await sql<{ conname: string }[]>`
      SELECT conname
      FROM pg_constraint
      WHERE conname = ANY(${EXPECTED_ELIGIBILITY_REWARD_CONSTRAINTS})
    `;
    const foundConstraints = new Set(constraintRows.map((row) => row.conname));
    const missingConstraints = EXPECTED_ELIGIBILITY_REWARD_CONSTRAINTS.filter(
      (name) => !foundConstraints.has(name),
    );

    if (missingConstraints.length > 0) {
      throw new Error(
        `Missing eligibility/reward constraints: ${missingConstraints.join(", ")}`,
      );
    }

    process.stdout.write("Database schema verified.\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
