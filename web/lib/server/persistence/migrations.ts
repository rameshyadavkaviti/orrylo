import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { DatabaseClient } from "./database";

const REWARD_UNIQUENESS_MIGRATION = "002_reward_wallet_type_uniqueness.sql";
const REWARD_UNIQUENESS_CHECKSUM =
  "97b70491e97ad7185acbf56d898010fd6662c824de18b0c6a934f83d551d206b";

export interface MigrationResult {
  applied: string[];
  verified: string[];
  reconciled: string[];
}

export async function migrateDatabase(
  sql: DatabaseClient,
  migrationsDirectory: string,
): Promise<MigrationResult> {
  // Guard initial ledger creation as well as each migration against concurrent runners.
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(19820608, 2)`;
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
  });

  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  const result: MigrationResult = { applied: [], verified: [], reconciled: [] };

  for (const name of names) {
    const migrationSql = await readFile(
      join(migrationsDirectory, name),
      "utf8",
    );
    const checksum = createHash("sha256")
      .update(migrationSql, "utf8")
      .digest("hex");

    const outcome = await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(19820608, 2)`;

      // Recheck under the lock: another runner may have completed this migration.
      const [existing] = await transaction<{ checksum: string }[]>`
        SELECT checksum
        FROM schema_migrations
        WHERE name = ${name}
      `;

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(`Migration checksum mismatch: ${name}`);
        }

        return "verified" as const;
      }

      if (name === REWARD_UNIQUENESS_MIGRATION) {
        const [state] = await transaction<
          {
            matches: boolean;
            relation_exists: boolean;
          }[]
        >`
          SELECT
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_constraint AS constraint_record
              JOIN pg_catalog.pg_class AS reward_table
                ON reward_table.oid = constraint_record.conrelid
              JOIN pg_catalog.pg_namespace AS table_schema
                ON table_schema.oid = reward_table.relnamespace
              JOIN pg_catalog.pg_class AS backing_index
                ON backing_index.oid = constraint_record.conindid
              JOIN pg_catalog.pg_index AS index_metadata
                ON index_metadata.indexrelid = backing_index.oid
              WHERE constraint_record.conname =
                  'reward_records_wallet_reward_type_unique'
                AND constraint_record.contype = 'u'
                AND constraint_record.convalidated
                AND NOT constraint_record.condeferrable
                AND NOT constraint_record.condeferred
                AND table_schema.nspname = current_schema()
                AND reward_table.relname = 'reward_records'
                AND backing_index.relname =
                  'reward_records_wallet_reward_type_unique'
                AND backing_index.relnamespace = reward_table.relnamespace
                AND index_metadata.indisunique
                AND index_metadata.indisvalid
                AND index_metadata.indisready
                AND index_metadata.indislive
                AND pg_catalog.pg_get_constraintdef(constraint_record.oid) =
                  'UNIQUE (wallet_public_key, reward_type)'
                AND pg_catalog.pg_get_indexdef(backing_index.oid) =
                  format(
                    'CREATE UNIQUE INDEX reward_records_wallet_reward_type_unique ON %I.reward_records USING btree (wallet_public_key, reward_type)',
                    current_schema()
                  )
            ) AS matches,
            to_regclass(
              format(
                '%I.%I',
                current_schema(),
                'reward_records_wallet_reward_type_unique'
              )
            ) IS NOT NULL AS relation_exists
        `;

        if (state?.matches) {
          if (checksum !== REWARD_UNIQUENESS_CHECKSUM) {
            throw new Error(
              `Refusing to reconcile modified migration: ${name}`,
            );
          }

          // The complete schema invariant is already present. Reconcile only
          // the missing ledger entry, retaining the original migration checksum.
          await transaction`
            INSERT INTO schema_migrations (name, checksum)
            VALUES (${name}, ${checksum})
          `;
          return "reconciled" as const;
        }

        if (state?.relation_exists) {
          throw new Error(
            "Refusing migration 002: the existing relation named " +
              "reward_records_wallet_reward_type_unique does not match " +
              "the approved UNIQUE constraint and backing index.",
          );
        }
      }

      await transaction.unsafe(migrationSql);
      await transaction`
        INSERT INTO schema_migrations (name, checksum)
        VALUES (${name}, ${checksum})
      `;
      return "applied" as const;
    });

    result[outcome].push(name);
  }

  return result;
}
