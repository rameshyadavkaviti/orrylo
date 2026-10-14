import { resolve } from "node:path";

import { createDatabaseClient } from "../lib/server/persistence/database";
import { verifyDatabaseSchemaReadOnly } from "../lib/server/persistence/schema-verification";

async function main() {
  const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required for read-only schema inspection.",
    );
  }

  const sql = createDatabaseClient(databaseUrl);

  try {
    await verifyDatabaseSchemaReadOnly(
      sql,
      resolve(process.cwd(), "db/migrations"),
    );
    process.stdout.write("Database schema verified read-only.\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
