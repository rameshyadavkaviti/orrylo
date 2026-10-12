import { resolve } from "node:path";

import { createDatabaseClient } from "../lib/server/persistence/database";
import { migrateDatabase } from "../lib/server/persistence/migrations";

async function main() {
  const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required and must use the non-runtime schema owner.",
    );
  }

  const sql = createDatabaseClient(databaseUrl);

  try {
    const result = await migrateDatabase(
      sql,
      resolve(process.cwd(), "db/migrations"),
    );

    process.stdout.write(
      `Migrations applied: ${result.applied.length}; reconciled: ${result.reconciled.length}; verified: ${result.verified.length}\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
