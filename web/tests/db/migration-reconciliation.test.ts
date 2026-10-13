import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, beforeEach, test } from "node:test";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

const ALL_MIGRATIONS = [
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
];

if (!TEST_DATABASE_URL) {
  test("migration reconciliation PostgreSQL suite", { skip: true }, () => {});
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);
  const directory = resolve(process.cwd(), "db/migrations");
  const migration002 = "002_reward_wallet_type_uniqueness.sql";

  beforeEach(async () => {
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    if (!/test/i.test(databaseName)) {
      throw new Error(
        "TEST_DATABASE_URL must point to a database whose name contains 'test'.",
      );
    }

    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  async function applyOnly001(): Promise<void> {
    const temporary = await mkdtemp(join(tmpdir(), "orrylo-migrate-"));
    try {
      await copyFile(
        join(directory, ALL_MIGRATIONS[0]),
        join(temporary, ALL_MIGRATIONS[0]),
      );
      const result = await migrateDatabase(sql, temporary);
      assert.deepEqual(result.applied, [ALL_MIGRATIONS[0]]);
      assert.deepEqual(result.reconciled, []);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async function installApprovedConstraint(): Promise<void> {
    await sql`
      ALTER TABLE reward_records
      ADD CONSTRAINT reward_records_wallet_reward_type_unique
      UNIQUE (wallet_public_key, reward_type)
    `;
  }

  test("fresh bootstrap applies 001-010 and repeated runs verify without changes", async () => {
    const first = await migrateDatabase(sql, directory);
    assert.deepEqual(first.applied, ALL_MIGRATIONS);
    assert.deepEqual(first.reconciled, []);
    assert.deepEqual(first.verified, []);

    const again = await migrateDatabase(sql, directory);
    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.reconciled, []);
    assert.deepEqual(again.verified, ALL_MIGRATIONS);
  });

  test("existing 001-005 database upgrades with 006-010 without rewriting earlier checksums or project rows", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "orrylo-pre-metadata-"));
    try {
      for (const migration of ALL_MIGRATIONS.slice(0, 5)) {
        await copyFile(join(directory, migration), join(temporary, migration));
      }
      const old = await migrateDatabase(sql, temporary);
      assert.deepEqual(old.applied, ALL_MIGRATIONS.slice(0, 5));
      const projectId = "00000000-0000-4000-8000-000000000112";
      await sql`
        INSERT INTO project_profiles (
          project_id, slug, asset_code, display_name, issuer_model, network,
          created_at, updated_at
        ) VALUES (
          ${projectId}, 'upgrade-fixture', 'UPGRADE', 'Upgrade Fixture',
          'shared', 'testnet', now(), now()
        )
      `;
      const before = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migrations ORDER BY name
      `;
      const upgraded = await migrateDatabase(sql, directory);
      assert.deepEqual(upgraded.applied, [
        "006_project_metadata_publications.sql",
        "007_testnet_project_issuance.sql",
        "008_gate_a_confirmation_provenance.sql",
        "009_signed_envelope_digest.sql",
        "010_mvp_lite_db_security_hardening.sql",
      ]);
      assert.deepEqual(upgraded.verified, ALL_MIGRATIONS.slice(0, 5));
      const after = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migrations ORDER BY name
      `;
      assert.deepEqual(after.slice(0, 5), [...before]);
      const [retained] = await sql<{ asset_code: string }[]>`
        SELECT asset_code FROM project_profiles WHERE project_id = ${projectId}
      `;
      assert.equal(retained.asset_code, "UPGRADE");
      const [{ exists }] = await sql<{ exists: string | null }[]>`
        SELECT to_regclass('project_metadata_publications')::text AS "exists"
      `;
      assert.equal(exists, "project_metadata_publications");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("existing 001-006 publication rows are retained but fail closed during 007-010 upgrade", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "orrylo-pre-confirmation-"));
    try {
      for (const migration of ALL_MIGRATIONS.slice(0, 6)) {
        await copyFile(join(directory, migration), join(temporary, migration));
      }
      await migrateDatabase(sql, temporary);
      const requestId = "00000000-0000-4000-8000-000000000201";
      const projectId = "00000000-0000-4000-8000-000000000202";
      const publicKey = `G${"A".repeat(55)}`;
      await sql`
        INSERT INTO workflow_intents (
          request_id, workflow_scope, workflow_type, state, idempotency_key,
          payload_hash, payload, created_at, updated_at, policy_version
        ) VALUES (
          ${requestId}, 'legacy', 'legacy', 'created', ${requestId},
          ${"a".repeat(64)}, ${sql.json({ legacy: true })}, now(), now(), 'legacy-v1'
        )
      `;
      await sql`
        INSERT INTO project_profiles (
          project_id, slug, asset_code, display_name, issuer_model, network,
          created_at, updated_at
        ) VALUES (
          ${projectId}, 'legacy-publication', 'LEGACY', 'Legacy Publication',
          'shared', 'testnet', now(), now()
        )
      `;
      await sql`
        INSERT INTO project_metadata_publications (
          project_id, metadata_home, network, asset_code, issuer_public_key,
          issuance_request_id, issuance_fingerprint, currency_toml,
          content_hash, published_at, updated_at, reachable, verified_at,
          last_verification_at
        ) VALUES (
          ${projectId}, 'assets.orrylo.com', 'testnet', 'LEGACY', ${publicKey},
          ${requestId}, ${"b".repeat(64)}, '[[CURRENCIES]]', ${"c".repeat(64)},
          now(), now(), true, now(), now()
        )
      `;

      const upgraded = await migrateDatabase(sql, directory);
      assert.deepEqual(upgraded.applied, [
        "007_testnet_project_issuance.sql",
        "008_gate_a_confirmation_provenance.sql",
        "009_signed_envelope_digest.sql",
        "010_mvp_lite_db_security_hardening.sql",
      ]);
      const [legacy] = await sql<
        {
          confirmation_id: string | null;
          reachable: boolean;
          verification_error_code: string | null;
        }[]
      >`
        SELECT confirmation_id, reachable, verification_error_code
        FROM project_metadata_publications WHERE project_id = ${projectId}
      `;
      assert.equal(legacy.confirmation_id, null);
      assert.equal(legacy.reachable, false);
      assert.equal(
        legacy.verification_error_code,
        "confirmation_contract_unavailable",
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("existing 001-007 database upgrades add scoped confirmation provenance without rewriting history", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "orrylo-pre-gate-a-"));
    try {
      for (const migration of ALL_MIGRATIONS.slice(0, 7)) {
        await copyFile(join(directory, migration), join(temporary, migration));
      }
      await migrateDatabase(sql, temporary);
      const before = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migrations ORDER BY name
      `;
      const upgraded = await migrateDatabase(sql, directory);
      assert.deepEqual(upgraded.applied, [
        "008_gate_a_confirmation_provenance.sql",
        "009_signed_envelope_digest.sql",
        "010_mvp_lite_db_security_hardening.sql",
      ]);
      assert.deepEqual(upgraded.verified, ALL_MIGRATIONS.slice(0, 7));
      const after = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migrations ORDER BY name
      `;
      assert.deepEqual(after.slice(0, 7), [...before]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("existing 001-008 database adds signed-envelope persistence and MVP Lite hardening without rewriting history", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "orrylo-pre-digest-"));
    try {
      for (const migration of ALL_MIGRATIONS.slice(0, 8)) {
        await copyFile(join(directory, migration), join(temporary, migration));
      }
      await migrateDatabase(sql, temporary);
      const before = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migrations ORDER BY name
      `;
      const upgraded = await migrateDatabase(sql, directory);
      assert.deepEqual(upgraded.applied, [
        "009_signed_envelope_digest.sql",
        "010_mvp_lite_db_security_hardening.sql",
      ]);
      assert.deepEqual(upgraded.verified, ALL_MIGRATIONS.slice(0, 8));
      const after = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migrations ORDER BY name
      `;
      assert.deepEqual(after.slice(0, 8), [...before]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("existing 001-009 successor attempts survive 010 while new successor writes fail closed", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "orrylo-pre-db-hardening-"));
    try {
      for (const migration of ALL_MIGRATIONS.slice(0, 9)) {
        await copyFile(join(directory, migration), join(temporary, migration));
      }
      await migrateDatabase(sql, temporary);

      const owner = "G" + "A".repeat(55);
      const issuer = "G" + "B".repeat(55);
      const destination = "G" + "C".repeat(55);
      const passphraseHash =
        "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472";
      const reservationFingerprint = "a".repeat(64);
      const historicalFingerprint = "b".repeat(64);
      const freshFingerprint = "c".repeat(64);
      const historicalRequest = "00000000-0000-4000-8000-000000000901";
      const historicalProject = "00000000-0000-4000-8000-000000000902";
      const historicalAttempt1 = "00000000-0000-4000-8000-000000000903";
      const historicalAttempt2 = "00000000-0000-4000-8000-000000000904";
      const freshRequest = "00000000-0000-4000-8000-000000000911";
      const freshProject = "00000000-0000-4000-8000-000000000912";

      async function seedContext(input: {
        requestId: string;
        projectId: string;
        slug: string;
        code: string;
        fingerprint: string;
        reservationFingerprint: string;
      }) {
        await sql`
          INSERT INTO workflow_intents (
            request_id, workflow_scope, workflow_type, subject_public_key,
            state, idempotency_key, payload_hash, payload, created_at,
            updated_at, policy_version
          ) VALUES (
            ${input.requestId}, 'asset:testnet-shared-issuance',
            'shared_asset_issuance', ${owner}, 'created',
            ${input.requestId}, ${input.reservationFingerprint},
            ${sql.json({ upgrade: true })}, now(), now(), 'upgrade-fixture-v1'
          )
        `;
        await sql`
          INSERT INTO project_profiles (
            project_id, slug, asset_code, display_name, issuer_model, network,
            created_at, updated_at
          ) VALUES (
            ${input.projectId}, ${input.slug}, ${input.code},
            ${`${input.code} Token`}, 'shared', 'testnet', now(), now()
          )
        `;
        await sql`
          INSERT INTO project_issuance_intents (
            project_id, request_id, owner_public_key, network,
            reservation_issuer_public_key, asset_code,
            reservation_fingerprint, status, created_at, updated_at
          ) VALUES (
            ${input.projectId}, ${input.requestId}, ${owner}, 'testnet',
            ${issuer}, ${input.code}, ${input.reservationFingerprint},
            'awaiting_issuer_integration', now(), now()
          )
        `;
        await sql`
          INSERT INTO project_issuance_full_intents (
            issuance_request_id, issuance_intent_fingerprint,
            reservation_fingerprint, project_id, owner_public_key, network,
            network_passphrase_hash, asset_code, issuer_public_key,
            destination_public_key, amount, policy_version, created_at
          ) VALUES (
            ${input.requestId}, ${input.fingerprint},
            ${input.reservationFingerprint}, ${input.projectId}, ${owner},
            'testnet', ${passphraseHash}, ${input.code}, ${issuer},
            ${destination}, 10.0000000, 'upgrade-fixture-v1', now()
          )
        `;
      }

      await seedContext({
        requestId: historicalRequest,
        projectId: historicalProject,
        slug: "historical-successor",
        code: "HIST2",
        fingerprint: historicalFingerprint,
        reservationFingerprint,
      });
      await seedContext({
        requestId: freshRequest,
        projectId: freshProject,
        slug: "fresh-attempt",
        code: "FRESH1",
        fingerprint: freshFingerprint,
        reservationFingerprint: "d".repeat(64),
      });

      for (const attempt of [
        {
          id: historicalAttempt1,
          number: 1,
          transactionHash: "1".repeat(64),
          envelopeHash: "2".repeat(64),
          sourceSequence: "100",
        },
        {
          id: historicalAttempt2,
          number: 2,
          transactionHash: "3".repeat(64),
          envelopeHash: "4".repeat(64),
          sourceSequence: "101",
        },
      ]) {
        await sql`
          INSERT INTO project_issuance_transaction_attempts (
            attempt_id, issuance_request_id, issuance_intent_fingerprint,
            attempt_number, transaction_hash, envelope_xdr_sha256,
            source_sequence, fee_stroops, valid_from, valid_until,
            transaction_source_public_key, operation_count, operation_type,
            operation_source_public_key, asset_code, issuer_public_key,
            destination_public_key, amount, created_at
          ) VALUES (
            ${attempt.id}, ${historicalRequest}, ${historicalFingerprint},
            ${attempt.number}, ${attempt.transactionHash}, ${attempt.envelopeHash},
            ${attempt.sourceSequence}, 100, 1800000000, 1800000300,
            ${issuer}, 1, 'payment', ${issuer}, 'HIST2', ${issuer},
            ${destination}, 10.0000000, now()
          )
        `;
      }

      await sql`
        INSERT INTO project_metadata_publications (
          project_id, metadata_home, network, asset_code, issuer_public_key,
          issuance_request_id, issuance_fingerprint, currency_toml,
          content_hash, published_at, updated_at, reachable
        ) VALUES (
          ${historicalProject}, 'assets.orrylo.com', 'testnet', 'HIST2',
          ${issuer}, ${historicalRequest}, ${historicalFingerprint},
          '[[CURRENCIES]]', ${"e".repeat(64)}, now(), now(), false
        )
      `;

      const historicalBefore = await sql<
        {
          attempt_id: string;
          attempt_number: number;
          transaction_hash: string;
          envelope_xdr_sha256: string;
          source_sequence: string;
        }[]
      >`
        SELECT attempt_id::text, attempt_number, transaction_hash,
          envelope_xdr_sha256, source_sequence::text
        FROM project_issuance_transaction_attempts
        WHERE issuance_request_id = ${historicalRequest}
        ORDER BY attempt_number
      `;
      assert.deepEqual(
        historicalBefore.map((row) => row.attempt_number),
        [1, 2],
      );

      const beforeMigrations = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migrations ORDER BY name
      `;
      const upgraded = await migrateDatabase(sql, directory);
      assert.deepEqual(upgraded.applied, [
        "010_mvp_lite_db_security_hardening.sql",
      ]);
      assert.deepEqual(upgraded.verified, ALL_MIGRATIONS.slice(0, 9));

      const afterMigrations = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migrations ORDER BY name
      `;
      assert.deepEqual(afterMigrations.slice(0, 9), beforeMigrations);
      const historicalAfter = await sql<
        {
          attempt_id: string;
          attempt_number: number;
          transaction_hash: string;
          envelope_xdr_sha256: string;
          source_sequence: string;
        }[]
      >`
        SELECT attempt_id::text, attempt_number, transaction_hash,
          envelope_xdr_sha256, source_sequence::text
        FROM project_issuance_transaction_attempts
        WHERE issuance_request_id = ${historicalRequest}
        ORDER BY attempt_number
      `;
      assert.deepEqual(historicalAfter, historicalBefore);

      const [constraint] = await sql<
        {
          definition: string;
          validated: boolean;
        }[]
      >`
        SELECT pg_get_constraintdef(oid) AS definition,
          convalidated AS validated
        FROM pg_constraint
        WHERE conname = 'project_issuance_attempt_number_mvp_lite'
      `;
      assert.equal(
        constraint.definition,
        "CHECK ((attempt_number = 1)) NOT VALID",
      );
      assert.equal(constraint.validated, false);

      await sql.unsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_gate_a_upgrade_app_test') THEN
            CREATE ROLE orrylo_gate_a_upgrade_app_test LOGIN PASSWORD 'gate-a-upgrade-app-test';
          END IF;
        END;
        $$;
        ALTER ROLE orrylo_gate_a_upgrade_app_test PASSWORD 'gate-a-upgrade-app-test';
        GRANT USAGE ON SCHEMA public TO orrylo_gate_a_upgrade_app_test;
        GRANT SELECT, INSERT ON project_issuance_full_intents,
          project_issuance_transaction_attempts TO orrylo_gate_a_upgrade_app_test;
        GRANT UPDATE (signed_envelope_xdr_sha256)
          ON project_issuance_transaction_attempts
          TO orrylo_gate_a_upgrade_app_test;
        GRANT SELECT, INSERT, UPDATE ON project_metadata_publications
          TO orrylo_gate_a_upgrade_app_test;
      `);

      const appUrl = new URL(databaseUrl);
      appUrl.username = "orrylo_gate_a_upgrade_app_test";
      appUrl.password = "gate-a-upgrade-app-test";
      const appSql = createDatabaseClient(appUrl.toString());
      try {
        const freshAttempt1 = "00000000-0000-4000-8000-000000000913";
        await appSql`
          INSERT INTO project_issuance_transaction_attempts (
            attempt_id, issuance_request_id, issuance_intent_fingerprint,
            attempt_number, transaction_hash, envelope_xdr_sha256,
            source_sequence, fee_stroops, valid_from, valid_until,
            transaction_source_public_key, operation_count, operation_type,
            operation_source_public_key, asset_code, issuer_public_key,
            destination_public_key, amount, created_at
          ) VALUES (
            ${freshAttempt1}, ${freshRequest}, ${freshFingerprint}, 1,
            ${"5".repeat(64)}, ${"6".repeat(64)}, 200, 100,
            1800000000, 1800000300, ${issuer}, 1, 'payment', ${issuer},
            'FRESH1', ${issuer}, ${destination}, 10.0000000, now()
          )
        `;

        await assert.rejects(
          appSql`
            INSERT INTO project_issuance_transaction_attempts (
              attempt_id, issuance_request_id, issuance_intent_fingerprint,
              attempt_number, transaction_hash, envelope_xdr_sha256,
              source_sequence, fee_stroops, valid_from, valid_until,
              transaction_source_public_key, operation_count, operation_type,
              operation_source_public_key, asset_code, issuer_public_key,
              destination_public_key, amount, created_at
            ) VALUES (
              ${"00000000-0000-4000-8000-000000000914"}, ${freshRequest},
              ${freshFingerprint}, 2, ${"7".repeat(64)}, ${"8".repeat(64)},
              201, 100, 1800000000, 1800000300, ${issuer}, 1, 'payment',
              ${issuer}, 'FRESH1', ${issuer}, ${destination},
              10.0000000, now()
            )
          `,
          (error: unknown) =>
            (error as { constraint_name?: string }).constraint_name ===
            "project_issuance_attempt_number_mvp_lite",
        );
        const [{ fresh_count: freshCount }] = await appSql<
          { fresh_count: string }[]
        >`
          SELECT count(*)::text AS fresh_count
          FROM project_issuance_transaction_attempts
          WHERE issuance_request_id = ${freshRequest}
        `;
        assert.equal(freshCount, "1");

        await assert.rejects(
          appSql`
            UPDATE project_metadata_publications
            SET reachable = true, verified_at = now(),
                last_verification_at = now()
            WHERE project_id = ${historicalProject}
          `,
          (error: unknown) =>
            (error as { constraint_name?: string }).constraint_name ===
            "project_metadata_publications_signed_confirmation_required",
        );
      } finally {
        await appSql.end({ timeout: 5 });
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("approved production-like constraint is adopted without changing existing objects or data", async () => {
    await applyOnly001();
    await installApprovedConstraint();

    await sql`
      INSERT INTO reward_records (
        reward_id, wallet_public_key, reward_type, amount, status,
        idempotency_key, reward_uniqueness_key, policy_version,
        created_at, updated_at
      )
      VALUES (
        '00000000-0000-4000-8000-000000000001',
        ${"G" + "A".repeat(55)},
        'INTEGRATION_TEST', 1, 'created',
        'existing-key', 'existing-reward', 'test-policy',
        now(), now()
      )
    `;

    const [before] = await sql<{ constraint_oid: string; index_oid: string }[]>`
      SELECT c.oid::text AS constraint_oid, c.conindid::text AS index_oid
      FROM pg_constraint AS c
      WHERE c.conname = 'reward_records_wallet_reward_type_unique'
        AND c.conrelid = 'reward_records'::regclass
    `;
    assert.ok(before);

    const result = await migrateDatabase(sql, directory);
    assert.deepEqual(result.verified, [ALL_MIGRATIONS[0]]);
    assert.deepEqual(result.reconciled, [migration002]);
    assert.deepEqual(result.applied, ALL_MIGRATIONS.slice(2));

    const [ledger] = await sql<
      {
        checksum: string;
        applied_at: Date;
      }[]
    >`
      SELECT checksum, applied_at
      FROM schema_migrations
      WHERE name = ${migration002}
    `;
    const originalSql = await readFile(join(directory, migration002), "utf8");
    assert.equal(
      ledger?.checksum.trim(),
      createHash("sha256").update(originalSql).digest("hex"),
    );
    assert.ok(ledger?.applied_at instanceof Date);

    const [afterState] = await sql<
      {
        constraint_oid: string;
        index_oid: string;
      }[]
    >`
      SELECT c.oid::text AS constraint_oid, c.conindid::text AS index_oid
      FROM pg_constraint AS c
      WHERE c.conname = 'reward_records_wallet_reward_type_unique'
        AND c.conrelid = 'reward_records'::regclass
    `;
    assert.deepEqual(afterState, before);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM reward_records
    `;
    assert.equal(count, "1");

    await assert.rejects(
      sql`
        INSERT INTO reward_records (
          reward_id, wallet_public_key, reward_type, amount, status,
          idempotency_key, reward_uniqueness_key, policy_version,
          created_at, updated_at
        )
        VALUES (
          '00000000-0000-4000-8000-000000000002',
          ${"G" + "A".repeat(55)},
          'INTEGRATION_TEST', 2, 'created',
          'different-key', 'different-reward', 'test-policy',
          now(), now()
        )
      `,
      (error: unknown) =>
        (error as { constraint_name?: string }).constraint_name ===
        "reward_records_wallet_reward_type_unique",
    );

    const again = await migrateDatabase(sql, directory);
    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.reconciled, []);
    assert.deepEqual(again.verified, ALL_MIGRATIONS);
  });

  test("rejects a same-named UNIQUE constraint with the wrong column order", async () => {
    await applyOnly001();
    await sql`
      ALTER TABLE reward_records
      ADD CONSTRAINT reward_records_wallet_reward_type_unique
      UNIQUE (reward_type, wallet_public_key)
    `;

    await assert.rejects(
      migrateDatabase(sql, directory),
      /Refusing migration 002/,
    );

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM schema_migrations
    `;
    assert.equal(count, "1");
  });

  test("rejects a standalone unique index with the expected name", async () => {
    await applyOnly001();
    await sql`
      CREATE UNIQUE INDEX reward_records_wallet_reward_type_unique
      ON reward_records (wallet_public_key, reward_type)
    `;

    await assert.rejects(
      migrateDatabase(sql, directory),
      /Refusing migration 002/,
    );

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM schema_migrations
    `;
    assert.equal(count, "1");
  });

  test("recorded migration checksum mismatch still fails closed", async () => {
    await migrateDatabase(sql, directory);
    await sql`
      UPDATE schema_migrations
      SET checksum = ${"0".repeat(64)}
      WHERE name = ${migration002}
    `;

    await assert.rejects(
      migrateDatabase(sql, directory),
      /Migration checksum mismatch: 002_reward_wallet_type_uniqueness.sql/,
    );
  });

  test("cannot reconcile a modified 002 file even when its constraint matches", async () => {
    await applyOnly001();
    await installApprovedConstraint();

    const temporary = await mkdtemp(join(tmpdir(), "orrylo-migrate-"));
    try {
      await copyFile(
        join(directory, ALL_MIGRATIONS[0]),
        join(temporary, ALL_MIGRATIONS[0]),
      );
      const originalSql = await readFile(join(directory, migration002), "utf8");
      await writeFile(join(temporary, migration002), originalSql + "\n");

      await assert.rejects(
        migrateDatabase(sql, temporary),
        /Refusing to reconcile modified migration/,
      );

      const [{ count }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM schema_migrations
      `;
      assert.equal(count, "1");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("concurrent runners reconcile migration 002 only once", async () => {
    await applyOnly001();
    await installApprovedConstraint();

    const results = await Promise.all([
      migrateDatabase(sql, directory),
      migrateDatabase(sql, directory),
    ]);

    assert.equal(
      results.filter((result) => result.reconciled.includes(migration002))
        .length,
      1,
    );

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM schema_migrations
    `;
    assert.equal(count, String(ALL_MIGRATIONS.length));
  });
}
