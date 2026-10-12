import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { DatabaseClient } from "./database";

export interface MigrationResult {
  applied: string[];
  reconciled: string[];
  verified: string[];
}

export class MigrationSchemaDriftError extends Error {
  constructor(
    readonly migrationName: string,
    readonly presentEffects: string[],
    readonly missingEffects: string[],
  ) {
    super(
      `Migration schema drift: ${migrationName}; present: ${
        presentEffects.join(", ") || "none"
      }; missing: ${missingEffects.join(", ") || "none"}`,
    );
    this.name = "MigrationSchemaDriftError";
  }
}

type LegacyMigrationState =
  | { status: "none" }
  | { status: "complete" }
  | {
      status: "partial";
      presentEffects: string[];
      missingEffects: string[];
    };

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

  const result: MigrationResult = {
    applied: [],
    reconciled: [],
    verified: [],
  };

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

    const legacyState = await inspectLegacyMigrationState(sql, name);

    if (legacyState.status === "partial") {
      throw new MigrationSchemaDriftError(
        name,
        legacyState.presentEffects,
        legacyState.missingEffects,
      );
    }

    if (legacyState.status === "complete") {
      await sql`
        INSERT INTO schema_migrations (name, checksum)
        VALUES (${name}, ${checksum})
      `;
      result.reconciled.push(name);
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

async function inspectLegacyMigrationState(
  sql: DatabaseClient,
  name: string,
): Promise<LegacyMigrationState> {
  switch (name) {
    case "002_reward_wallet_type_uniqueness.sql":
      return inspectRewardWalletTypeUniqueness(sql);
    case "003_eligibility_reward_workflow.sql":
      return inspectEligibilityRewardWorkflow(sql);
    default:
      return { status: "none" };
  }
}

async function inspectRewardWalletTypeUniqueness(
  sql: DatabaseClient,
): Promise<LegacyMigrationState> {
  const [row] = await sql<
    {
      constraint_exists: boolean;
      relation_exists: boolean;
      definition: string | null;
    }[]
  >`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'reward_records'
          AND c.conname = 'reward_records_wallet_reward_type_unique'
          AND c.contype = 'u'
      ) AS constraint_exists,
      to_regclass(
        'public.reward_records_wallet_reward_type_unique'
      ) IS NOT NULL AS relation_exists,
      (
        SELECT pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'reward_records'
          AND c.conname = 'reward_records_wallet_reward_type_unique'
        LIMIT 1
      ) AS definition
  `;

  if (!row) {
    return { status: "none" };
  }

  const effects = {
    reward_wallet_type_unique_constraint:
      row.constraint_exists &&
      row.definition === "UNIQUE (wallet_public_key, reward_type)",
    reward_wallet_type_unique_relation: row.relation_exists,
  };

  return classifyEffects(effects);
}

async function inspectEligibilityRewardWorkflow(
  sql: DatabaseClient,
): Promise<LegacyMigrationState> {
  const [row] = await sql<
    {
      qualifying_event_table: boolean;
      qualifying_event_columns: boolean;
      eligibility_event_column: boolean;
      eligibility_event_unique_index: boolean;
      eligibility_event_fk: boolean;
      eligibility_first_token_check: boolean;
      reward_amount_check: boolean;
      reward_event_fk: boolean;
      reward_evidence_check: boolean;
      qualifying_event_processing_check: boolean;
    }[]
  >`
    SELECT
      to_regclass(
        'public.token_creation_qualifying_events'
      ) IS NOT NULL AS qualifying_event_table,
      (
        SELECT count(*) = 12
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'token_creation_qualifying_events'
          AND column_name = ANY(ARRAY[
            'event_reference',
            'event_fingerprint',
            'wallet_public_key',
            'event_type',
            'event_occurred_at',
            'associated_reference',
            'source',
            'policy_version',
            'processing_state',
            'result',
            'received_at',
            'processed_at'
          ])
      ) AS qualifying_event_columns,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eligibility_records'
          AND column_name = 'qualifying_event_reference'
      ) AS eligibility_event_column,
      EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'eligibility_records'
          AND idx.relname = 'eligibility_records_qualifying_event_unique'
          AND i.indisunique
      ) AS eligibility_event_unique_index,
      EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'eligibility_records'
          AND c.conname = 'eligibility_records_qualifying_event_fk'
          AND c.contype = 'f'
      ) AS eligibility_event_fk,
      EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'eligibility_records'
          AND c.conname = 'eligibility_records_first_token_event_required'
          AND c.contype = 'c'
      ) AS eligibility_first_token_check,
      EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'reward_records'
          AND c.conname = 'reward_records_first_token_amount_check'
          AND c.contype = 'c'
      ) AS reward_amount_check,
      EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'reward_records'
          AND c.conname = 'reward_records_qualifying_event_fk'
          AND c.contype = 'f'
      ) AS reward_event_fk,
      EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'reward_records'
          AND c.conname = 'reward_records_first_token_evidence_required'
          AND c.contype = 'c'
      ) AS reward_evidence_check,
      EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'token_creation_qualifying_events'
          AND c.conname =
            'token_creation_qualifying_events_processing_check'
          AND c.contype = 'c'
      ) AS qualifying_event_processing_check
  `;

  if (!row) {
    return { status: "none" };
  }

  return classifyEffects({
    qualifying_event_table: row.qualifying_event_table,
    qualifying_event_columns: row.qualifying_event_columns,
    eligibility_event_column: row.eligibility_event_column,
    eligibility_event_unique_index: row.eligibility_event_unique_index,
    eligibility_event_fk: row.eligibility_event_fk,
    eligibility_first_token_check: row.eligibility_first_token_check,
    reward_amount_check: row.reward_amount_check,
    reward_event_fk: row.reward_event_fk,
    reward_evidence_check: row.reward_evidence_check,
    qualifying_event_processing_check: row.qualifying_event_processing_check,
  });
}

function classifyEffects(
  effects: Record<string, boolean>,
): LegacyMigrationState {
  const entries = Object.entries(effects);
  const presentEffects = entries
    .filter(([, present]) => present)
    .map(([effect]) => effect);
  const missingEffects = entries
    .filter(([, present]) => !present)
    .map(([effect]) => effect);

  if (presentEffects.length === 0) {
    return { status: "none" };
  }

  if (missingEffects.length === 0) {
    return { status: "complete" };
  }

  return {
    status: "partial",
    presentEffects,
    missingEffects,
  };
}
