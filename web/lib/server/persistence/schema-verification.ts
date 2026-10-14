import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type postgres from "postgres";

import type { DatabaseClient } from "./database";

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
  "project_profiles",
  "project_profile_owners",
  "project_metadata_publications",
  "project_issuance_intents",
  "project_issuance_full_intents",
  "project_issuance_transaction_attempts",
  "project_issuance_ledger_confirmations",
] as const;

const EXPECTED_CONSTRAINTS = [
  "project_profile_owners_wallet_check",
  "project_metadata_publications_updated_after_published",
  "project_metadata_publications_reachable_verified",
  "project_metadata_publications_verified_attempted",
  "project_metadata_publications_asset_identity_unique",
  "project_metadata_publications_issuance_request_fk",
  "project_metadata_publications_issuance_request_unique",
  "project_metadata_publications_confirmation_fk",
  "project_metadata_publications_confirmation_unique",
  "project_metadata_publications_confirmation_required",
  "eligibility_records_first_token_event_required",
  "eligibility_records_qualifying_event_fk",
  "reward_records_first_token_amount_check",
  "reward_records_first_token_evidence_required",
  "reward_records_qualifying_event_fk",
  "token_creation_qualifying_events_processing_check",
  "project_issuance_unique_asset_code",
  "project_issuance_reservation_identity_unique",
  "project_issuance_full_intent_identity_unique",
  "project_issuance_full_intent_reservation_fk",
  "project_issuance_attempt_intent_fk",
  "project_issuance_attempt_confirmation_identity_unique",
  "project_issuance_confirmation_intent_fk",
  "project_issuance_confirmation_attempt_fk",
  "project_issuance_confirmation_provenance_unique",
  "project_issuance_confirmation_request_unique",
  "project_issuance_confirmation_transaction_unique",
  "project_issuance_confirmation_publication_identity_unique",
  "project_issuance_attempt_signed_envelope_hash",
  "project_issuance_confirmation_signed_envelope_hash",
  "project_issuance_attempt_number_mvp_lite",
  "project_metadata_publications_confirmation_scope_fk",
  "project_metadata_publications_owner_required",
] as const;

export interface ExpectedMigrationEvidence {
  name: string;
  checksum: string;
}

export async function loadExpectedMigrationEvidence(
  migrationsDirectory: string,
): Promise<ExpectedMigrationEvidence[]> {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(join(migrationsDirectory, name), "utf8"), "utf8")
        .digest("hex"),
    })),
  );
}

export async function verifyDatabaseSchemaReadOnly(
  sql: DatabaseClient,
  migrationsDirectory: string,
): Promise<void> {
  const expectedMigrations =
    await loadExpectedMigrationEvidence(migrationsDirectory);

  await sql.begin("read only", async (transaction) => {
    await verifyMigrationEvidence(transaction, expectedMigrations);
    await verifyCatalogState(transaction);
  });
}

async function verifyMigrationEvidence(
  sql: postgres.TransactionSql,
  expectedMigrations: ExpectedMigrationEvidence[],
) {
  const rows = await sql<ExpectedMigrationEvidence[]>`
    SELECT name, checksum
    FROM schema_migrations
    ORDER BY name
  `;
  const found = new Map(rows.map((row) => [row.name, row.checksum]));
  const expectedNames = new Set(
    expectedMigrations.map((migration) => migration.name),
  );

  for (const migration of expectedMigrations) {
    const checksum = found.get(migration.name);
    if (!checksum) {
      throw new Error(`Missing migration evidence: ${migration.name}`);
    }
    if (checksum !== migration.checksum) {
      throw new Error(`Migration checksum mismatch: ${migration.name}`);
    }
  }

  const unexpected = rows
    .map((row) => row.name)
    .filter((name) => !expectedNames.has(name));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected migration evidence: ${unexpected.join(", ")}`);
  }
}

async function verifyCatalogState(sql: postgres.TransactionSql) {
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
    WHERE conname = ANY(${EXPECTED_CONSTRAINTS})
  `;
  const foundConstraints = new Set(constraintRows.map((row) => row.conname));
  const missingConstraints = EXPECTED_CONSTRAINTS.filter(
    (name) => !foundConstraints.has(name),
  );

  if (missingConstraints.length > 0) {
    throw new Error(
      `Missing required constraints: ${missingConstraints.join(", ")}`,
    );
  }

  const [writerRole] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = 'orrylo_confirmation_writer'
        AND rolcanlogin = false
    ) AS "exists"
  `;
  if (!writerRole?.exists) {
    throw new Error("Missing non-login trusted confirmation writer role.");
  }

  const ownershipRows = await sql<
    { object_name: string; owner_name: string }[]
  >`
    SELECT relation.relname AS object_name,
      pg_get_userbyid(relation.relowner) AS owner_name
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema()
      AND relation.relname IN (
        'project_issuance_full_intents',
        'project_issuance_transaction_attempts',
        'project_issuance_ledger_confirmations'
      )
    UNION ALL
    SELECT procedure.proname AS object_name,
      pg_get_userbyid(procedure.proowner) AS owner_name
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = current_schema()
      AND procedure.proname IN (
        'assert_issuance_attempt_matches_intent',
        'assert_trusted_confirmation_writer',
        'protect_issuance_transaction_attempt',
        'prevent_issuance_evidence_mutation',
        'assert_metadata_reachability_signed_confirmation'
      )
  `;
  const [migrationIdentity] = await sql<{ role_name: string }[]>`
    SELECT current_user AS role_name
  `;
  const wrongOwners = ownershipRows.filter(
    (row) => row.owner_name !== migrationIdentity?.role_name,
  );
  if (ownershipRows.length !== 8 || wrongOwners.length > 0) {
    throw new Error(
      "Sensitive issuance tables and enforcement functions must be owned by the migration identity.",
    );
  }

  const [hardening] = await sql<
    {
      attempt_constraint: string | null;
      attempt_constraint_validated: boolean | null;
      trusted_writer_function_security_definer: boolean;
      trusted_writer_function_search_path: string[] | null;
      trusted_writer_trigger_count: number;
      trusted_writer_trigger_binding: boolean;
      reachability_trigger: boolean;
      reachability_function_security_definer: boolean;
      reachability_function_search_path: string[] | null;
      reachability_function_public_execute: boolean;
    }[]
  >`
    SELECT
      (
        SELECT pg_get_constraintdef(constraint_row.oid)
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conname =
          'project_issuance_attempt_number_mvp_lite'
          AND constraint_row.conrelid =
            'project_issuance_transaction_attempts'::regclass
      ) AS attempt_constraint,
      (
        SELECT constraint_row.convalidated
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conname =
          'project_issuance_attempt_number_mvp_lite'
          AND constraint_row.conrelid =
            'project_issuance_transaction_attempts'::regclass
      ) AS attempt_constraint_validated,
      COALESCE((
        SELECT procedure.prosecdef
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'assert_trusted_confirmation_writer'
        LIMIT 1
      ), true) AS trusted_writer_function_security_definer,
      (
        SELECT procedure.proconfig
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'assert_trusted_confirmation_writer'
        LIMIT 1
      ) AS trusted_writer_function_search_path,
      (
        SELECT count(*)::integer
        FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgname =
            'project_issuance_confirmation_trusted_writer'
          AND NOT trigger_row.tgisinternal
      ) AS trusted_writer_trigger_count,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_row
        JOIN pg_catalog.pg_class AS relation
          ON relation.oid = trigger_row.tgrelid
        JOIN pg_catalog.pg_namespace AS relation_namespace
          ON relation_namespace.oid = relation.relnamespace
        JOIN pg_catalog.pg_proc AS procedure
          ON procedure.oid = trigger_row.tgfoid
        JOIN pg_catalog.pg_namespace AS procedure_namespace
          ON procedure_namespace.oid = procedure.pronamespace
        WHERE trigger_row.tgname =
            'project_issuance_confirmation_trusted_writer'
          AND NOT trigger_row.tgisinternal
          AND trigger_row.tgenabled = 'O'
          AND trigger_row.tgtype = 7
          AND relation_namespace.nspname = 'public'
          AND relation.relname =
            'project_issuance_ledger_confirmations'
          AND procedure_namespace.nspname = 'public'
          AND procedure.proname = 'assert_trusted_confirmation_writer'
      ) AS trusted_writer_trigger_binding,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid =
            'project_metadata_publications'::regclass
          AND trigger_row.tgname =
            'project_metadata_publications_signed_confirmation_guard'
          AND NOT trigger_row.tgisinternal
      ) AS reachability_trigger,
      COALESCE((
        SELECT procedure.prosecdef
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = current_schema()
          AND procedure.proname =
            'assert_metadata_reachability_signed_confirmation'
        LIMIT 1
      ), false) AS reachability_function_security_definer,
      (
        SELECT procedure.proconfig
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = current_schema()
          AND procedure.proname =
            'assert_metadata_reachability_signed_confirmation'
        LIMIT 1
      ) AS reachability_function_search_path,
      COALESCE((
        SELECT bool_or(
          acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
        )
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
        WHERE namespace.nspname = current_schema()
          AND procedure.proname =
            'assert_metadata_reachability_signed_confirmation'
      ), false) AS reachability_function_public_execute
  `;
  if (
    hardening?.attempt_constraint !==
      "CHECK ((attempt_number = 1)) NOT VALID" ||
    hardening.attempt_constraint_validated !== false ||
    hardening.trusted_writer_function_security_definer ||
    !hardening.trusted_writer_function_search_path?.includes(
      "search_path=pg_catalog, public, pg_temp",
    ) ||
    hardening.trusted_writer_trigger_count !== 1 ||
    !hardening.trusted_writer_trigger_binding ||
    !hardening.reachability_trigger ||
    !hardening.reachability_function_security_definer ||
    !hardening.reachability_function_search_path?.includes(
      "search_path=pg_catalog, public",
    ) ||
    hardening.reachability_function_public_execute
  ) {
    throw new Error(
      "Missing or unsafe MVP Lite database hardening for attempt count, trusted confirmation writing/trigger binding, or metadata reachability.",
    );
  }
}
