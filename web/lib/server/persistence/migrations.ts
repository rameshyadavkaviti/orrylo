import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { DatabaseClient } from "./database";

export interface MigrationResult {
  applied: string[];
  verified: string[];
}

export async function migrateDatabase(
  sql: DatabaseClient,
  migrationsDirectory: string,
): Promise<MigrationResult> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  const result: MigrationResult = { applied: [], verified: [] };

  for (const name of names) {
    const migrationSql = await readFile(
      join(migrationsDirectory, name),
      "utf8",
    );
    const checksum = createHash("sha256")
      .update(migrationSql, "utf8")
      .digest("hex");
    const [existing] = await sql<{ checksum: string }[]>`
      SELECT checksum
      FROM schema_migrations
      WHERE name = ${name}
    `;

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${name}`);
      }

      result.verified.push(name);
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction.unsafe(migrationSql);
      await transaction`
        INSERT INTO schema_migrations (name, checksum)
        VALUES (${name}, ${checksum})
      `;
    });

    result.applied.push(name);
  }

  return result;
}
