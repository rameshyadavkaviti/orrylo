import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import type { DatabaseClient } from "../lib/server/persistence/database";
import {
  loadExpectedMigrationEvidence,
  verifyDatabaseSchemaReadOnly,
  type ExpectedMigrationEvidence,
} from "../lib/server/persistence/schema-verification";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "db/migrations");

test("loads exact ordered migration names and SHA-256 checksums", async () => {
  const evidence = await loadExpectedMigrationEvidence(MIGRATIONS_DIRECTORY);

  assert.deepEqual(
    evidence.map(({ name }) => name),
    [
      "001_application_persistence.sql",
      "002_reward_wallet_type_uniqueness.sql",
      "003_eligibility_reward_workflow.sql",
      "004_project_profiles.sql",
      "005_project_profile_ownership.sql",
      "006_project_metadata_publications.sql",
      "007_testnet_project_issuance.sql",
      "008_gate_a_confirmation_provenance.sql",
      "009_signed_envelope_digest.sql",
      "010_mvp_lite_db_security_hardening.sql",
      "011_shared_issuance_signing_mode.sql",
      "012_test8926_bounded_recovery_attempt.sql",
    ],
  );
  for (const migration of evidence) {
    assert.match(migration.checksum, /^[0-9a-f]{64}$/);
  }
});

interface FakeCatalogOptions {
  missingMigration?: string;
  missingTable?: string;
  corruptMigration?: string;
  unexpectedMigration?: string;
  missingSigningModeUpdate?: boolean;
  tableWideAttemptUpdate?: boolean;
  unrelatedAttemptUpdate?: boolean;
  writerBoundaryChanged?: boolean;
  recoveryAclChanged?: boolean;
  recoveryAuthorizationMissing?: boolean;
  recoveryTriggerMissing?: boolean;
}

function fakeDatabase(
  expectedMigrations: ExpectedMigrationEvidence[],
  options: FakeCatalogOptions = {},
) {
  const beginOptions: string[] = [];
  const queries: string[] = [];

  const transaction = (async (
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);

    if (query.includes("FROM schema_migrations")) {
      const rows = expectedMigrations
        .filter(({ name }) => name !== options.missingMigration)
        .map((migration) => ({
          ...migration,
          checksum:
            migration.name === options.corruptMigration
              ? "0".repeat(64)
              : migration.checksum,
        }));
      if (options.unexpectedMigration) {
        rows.push({
          name: options.unexpectedMigration,
          checksum: "f".repeat(64),
        });
      }
      return rows;
    }
    if (query.includes("FROM information_schema.tables")) {
      return (values[0] as readonly string[])
        .filter((name) => name !== options.missingTable)
        .map((table_name) => ({ table_name }));
    }
    if (query.startsWith("SELECT conname FROM pg_constraint")) {
      return (values[0] as readonly string[]).map((conname) => ({ conname }));
    }
    if (query.includes("app_update_columns")) {
      return [
        {
          app_role_exists: true,
          app_table_update: options.tableWideAttemptUpdate ?? false,
          app_update_columns: options.missingSigningModeUpdate
            ? ["signed_envelope_xdr_sha256"]
            : options.unrelatedAttemptUpdate
              ? [
                  "signed_envelope_xdr_sha256",
                  "signing_mode",
                  "source_sequence",
                ]
              : ["signed_envelope_xdr_sha256", "signing_mode"],
          writer_full_intents_select: true,
          writer_attempts_select: true,
          writer_attempts_update_columns: [],
          writer_confirmations_select: true,
          writer_confirmations_insert: true,
          writer_confirmations_update: options.writerBoundaryChanged ?? false,
          writer_confirmations_delete: false,
          writer_confirmations_truncate: false,
        },
      ];
    }
    if (query.includes("app_authorization_any")) {
      return [
        {
          app_authorization_any: options.recoveryAclChanged ?? false,
          app_evidence_any: false,
          writer_authorization_any: false,
          writer_evidence_select: true,
          writer_evidence_insert: true,
          writer_evidence_update: false,
          writer_evidence_delete: false,
          writer_evidence_truncate: false,
        },
      ];
    }
    if (query.includes("FROM pg_roles")) return [{ exists: true }];
    if (query.includes("UNION ALL")) {
      return [
        "project_issuance_full_intents",
        "project_issuance_transaction_attempts",
        "project_issuance_ledger_confirmations",
        "project_issuance_recovery_authorizations",
        "project_issuance_recovery_evidence",
        "assert_issuance_attempt_matches_intent",
        "assert_trusted_confirmation_writer",
        "protect_issuance_transaction_attempt",
        "prevent_issuance_evidence_mutation",
        "assert_metadata_reachability_signed_confirmation",
        "assert_trusted_recovery_evidence_writer",
        "assert_bounded_recovery_attempt_insert",
      ].map((object_name) => ({ object_name, owner_name: "schema_owner" }));
    }
    if (query.includes("current_user AS role_name")) {
      return [{ role_name: "schema_owner" }];
    }
    if (query.includes("attempt_constraint")) {
      return [
        {
          attempt_constraint:
            "CHECK ((attempt_number = ANY (ARRAY[1, 2]))) NOT VALID",
          attempt_constraint_validated: false,
          trusted_writer_function_security_definer: false,
          trusted_writer_function_search_path: [
            "search_path=pg_catalog, public, pg_temp",
          ],
          trusted_writer_trigger_count: 1,
          trusted_writer_trigger_binding: true,
          reachability_trigger: true,
          reachability_function_security_definer: true,
          reachability_function_search_path: ["search_path=pg_catalog, public"],
          reachability_function_public_execute: false,
        },
      ];
    if (query.includes("manual_constraint")) {
      return [
        {
          manual_constraint:
            "CHECK (((attempt_number <> 2) OR (signing_mode IS NULL) OR (signing_mode = 'manual'::text))) NOT VALID",
          manual_constraint_validated: false,
          evidence_writer_security_definer: true,
          evidence_writer_search_path: ["search_path=pg_catalog, public"],
          evidence_writer_public_execute: false,
          evidence_trigger_binding: !options.recoveryTriggerMissing,
          recovery_attempt_security_definer: true,
          recovery_attempt_search_path: ["search_path=pg_catalog, public"],
          recovery_attempt_public_execute: false,
          recovery_attempt_trigger_binding: !options.recoveryTriggerMissing,
          exact_authorization_count: options.recoveryAuthorizationMissing
            ? 0
            : 1,
        },
      ];
    }

    }

    throw new Error(`Unexpected inspection query: ${query}`);
  }) as unknown;

  const sql = {
    async begin(
      optionsValue: string,
      callback: (transactionSql: unknown) => Promise<void>,
    ) {
      beginOptions.push(optionsValue);
      await callback(transaction);
    },
  } as unknown as DatabaseClient;

  return { sql, beginOptions, queries };
}

test("complete expected schema passes using only a read-only transaction and inspection queries", async () => {
  const expected = await loadExpectedMigrationEvidence(MIGRATIONS_DIRECTORY);
  const fixture = fakeDatabase(expected);

  await verifyDatabaseSchemaReadOnly(fixture.sql, MIGRATIONS_DIRECTORY);

  assert.deepEqual(fixture.beginOptions, ["read only"]);
  assert.ok(fixture.queries.length > 0);
  for (const query of fixture.queries) {
    assert.match(query, /^SELECT\b/i);
  }
});

test("missing or mismatched migration evidence fails closed", async () => {
  const expected = await loadExpectedMigrationEvidence(MIGRATIONS_DIRECTORY);

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, {
        missingMigration: "010_mvp_lite_db_security_hardening.sql",
      }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Missing migration evidence: 010_mvp_lite_db_security_hardening\.sql/,
  );

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, {
        corruptMigration: "009_signed_envelope_digest.sql",
      }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Migration checksum mismatch: 009_signed_envelope_digest\.sql/,
  );

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, {
        unexpectedMigration: "011_unreviewed_schema.sql",
      }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Unexpected migration evidence: 011_unreviewed_schema\.sql/,
  );
});

test("missing required schema object fails closed", async () => {
  const expected = await loadExpectedMigrationEvidence(MIGRATIONS_DIRECTORY);

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, {
        missingTable: "project_issuance_ledger_confirmations",
      }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Missing database tables: project_issuance_ledger_confirmations/,
  );
});

test("runtime ACL verification fails closed for missing or broadened app UPDATE authority", async () => {
  const expected = await loadExpectedMigrationEvidence(MIGRATIONS_DIRECTORY);

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, { missingSigningModeUpdate: true }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Missing or unsafe orrylo_app attempt UPDATE ACL/,
  );

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, { tableWideAttemptUpdate: true }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Missing or unsafe orrylo_app attempt UPDATE ACL/,
  );

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, { unrelatedAttemptUpdate: true }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Missing or unsafe orrylo_app attempt UPDATE ACL/,
  );
});

test("bounded recovery verifier rejects app ACL drift, missing owner authorization, or trigger drift", async () => {
  const expected = await loadExpectedMigrationEvidence(MIGRATIONS_DIRECTORY);

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, { recoveryAclChanged: true }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Unexpected bounded recovery ACL/,
  );

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, { recoveryAuthorizationMissing: true }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Missing or unsafe bounded TEST8926 recovery hardening/,
  );

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, { recoveryTriggerMissing: true }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Missing or unsafe bounded TEST8926 recovery hardening/,
  );
});

test("runtime ACL verification rejects confirmation-writer privilege drift", async () => {
  const expected = await loadExpectedMigrationEvidence(MIGRATIONS_DIRECTORY);

  await assert.rejects(
    verifyDatabaseSchemaReadOnly(
      fakeDatabase(expected, { writerBoundaryChanged: true }).sql,
      MIGRATIONS_DIRECTORY,
    ),
    /Unexpected trusted confirmation writer ACL/,
  );
});
