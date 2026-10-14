import { resolve } from "node:path";

import { createDatabaseClient } from "../lib/server/persistence/database";
import { migrateDatabase } from "../lib/server/persistence/migrations";
import { verifyDatabaseSchemaReadOnly } from "../lib/server/persistence/schema-verification";

async function main() {
  const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required and must use the non-runtime schema owner.",
    );
  }

  const sql = createDatabaseClient(databaseUrl);
  const migrationsDirectory = resolve(process.cwd(), "db/migrations");

  try {
    await migrateDatabase(sql, migrationsDirectory);
    await verifyDatabaseSchemaReadOnly(sql, migrationsDirectory);
    process.stdout.write("Database schema verified.\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
