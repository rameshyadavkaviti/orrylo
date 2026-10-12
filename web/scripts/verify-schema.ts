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
  "project_metadata_publications_confirmation_scope_fk",
  "project_metadata_publications_owner_required",
] as const;

async function main() {
  const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required and must use the non-runtime schema owner.",
    );
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
          'prevent_issuance_evidence_mutation'
        )
    `;
    const [migrationIdentity] = await sql<{ role_name: string }[]>`
      SELECT current_user AS role_name
    `;
    const wrongOwners = ownershipRows.filter(
      (row) => row.owner_name !== migrationIdentity?.role_name,
    );
    if (ownershipRows.length !== 6 || wrongOwners.length > 0) {
      throw new Error(
        "Sensitive issuance tables and enforcement functions must be owned by the migration identity.",
      );
    }

    process.stdout.write("Database schema verified.\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
