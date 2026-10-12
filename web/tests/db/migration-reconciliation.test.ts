import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import {
  migrateDatabase,
  MigrationSchemaDriftError,
} from "../../lib/server/persistence/migrations";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("migration reconciliation PostgreSQL suite", { skip: true }, () => {});
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);
  const migrationsDirectory = resolve(process.cwd(), "db/migrations");
  const PUBLIC_KEY = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 71),
  ).publicKey();

  beforeEach(async () => {
    assertDedicatedTestDatabase(databaseUrl);
    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  test("fresh database still migrates from zero and repeats cleanly", async () => {
    const first = await migrateDatabase(sql, migrationsDirectory);

    assert.deepEqual(first.applied, [
      "001_application_persistence.sql",
      "002_reward_wallet_type_uniqueness.sql",
      "003_eligibility_reward_workflow.sql",
      "004_project_profiles.sql",
      "005_project_profile_ownership.sql",
    ]);
    assert.deepEqual(first.reconciled, []);
    assert.deepEqual(first.verified, []);

    const second = await migrateDatabase(sql, migrationsDirectory);

    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.reconciled, []);
    assert.deepEqual(second.verified, [
      "001_application_persistence.sql",
      "002_reward_wallet_type_uniqueness.sql",
      "003_eligibility_reward_workflow.sql",
      "004_project_profiles.sql",
      "005_project_profile_ownership.sql",
    ]);
  });

  test("production-style untracked 002 and 003 effects reconcile without data loss", async () => {
    await applyMigrationSql("001_application_persistence.sql");
    await applyMigrationSql("002_reward_wallet_type_uniqueness.sql");
    await applyMigrationSql("003_eligibility_reward_workflow.sql");
    await createMigrationLedgerWith(["001_application_persistence.sql"]);

    await sql`
      INSERT INTO auth_sessions (
        token_hash,
        public_key,
        created_at,
        expires_at,
        invalidated_at
      )
      VALUES (
        ${"a".repeat(64)},
        ${PUBLIC_KEY},
        ${new Date("2026-10-12T04:00:00.000Z")},
        ${new Date("2026-10-12T12:00:00.000Z")},
        NULL
      )
    `;

    const result = await migrateDatabase(sql, migrationsDirectory);

    assert.deepEqual(result.verified, ["001_application_persistence.sql"]);
    assert.deepEqual(result.reconciled, [
      "002_reward_wallet_type_uniqueness.sql",
      "003_eligibility_reward_workflow.sql",
    ]);
    assert.deepEqual(result.applied, [
      "004_project_profiles.sql",
      "005_project_profile_ownership.sql",
    ]);

    const migrationNames = await sql<{ name: string }[]>`
      SELECT name
      FROM schema_migrations
      ORDER BY name
    `;
    assert.deepEqual(
      migrationNames.map((row) => row.name),
      [
        "001_application_persistence.sql",
        "002_reward_wallet_type_uniqueness.sql",
        "003_eligibility_reward_workflow.sql",
        "004_project_profiles.sql",
        "005_project_profile_ownership.sql",
      ],
    );

    const [{ sessionCount }] = await sql<{ sessionCount: string }[]>`
      SELECT count(*)::text AS "sessionCount"
      FROM auth_sessions
      WHERE public_key = ${PUBLIC_KEY}
    `;
    assert.equal(sessionCount, "1");

    const [projectTables] = await sql<
      {
        project_profiles: string | null;
        project_profile_owners: string | null;
      }[]
    >`
      SELECT
        to_regclass('public.project_profiles')::text AS project_profiles,
        to_regclass(
          'public.project_profile_owners'
        )::text AS project_profile_owners
    `;
    assert.equal(projectTables?.project_profiles, "project_profiles");
    assert.equal(
      projectTables?.project_profile_owners,
      "project_profile_owners",
    );

    const repeated = await migrateDatabase(sql, migrationsDirectory);
    assert.deepEqual(repeated.applied, []);
    assert.deepEqual(repeated.reconciled, []);
    assert.equal(repeated.verified.length, 5);
  });

  test("partially initialized database with only migration 002 effect migrates safely", async () => {
    await applyMigrationSql("001_application_persistence.sql");
    await applyMigrationSql("002_reward_wallet_type_uniqueness.sql");
    await createMigrationLedgerWith(["001_application_persistence.sql"]);

    const result = await migrateDatabase(sql, migrationsDirectory);

    assert.deepEqual(result.verified, ["001_application_persistence.sql"]);
    assert.deepEqual(result.reconciled, [
      "002_reward_wallet_type_uniqueness.sql",
    ]);
    assert.deepEqual(result.applied, [
      "003_eligibility_reward_workflow.sql",
      "004_project_profiles.sql",
      "005_project_profile_ownership.sql",
    ]);
  });

  test("incomplete known legacy footprint fails explicitly instead of being adopted", async () => {
    await applyMigrationSql("001_application_persistence.sql");
    await applyMigrationSql("002_reward_wallet_type_uniqueness.sql");
    await createMigrationLedgerWith([
      "001_application_persistence.sql",
      "002_reward_wallet_type_uniqueness.sql",
    ]);

    await sql`
      ALTER TABLE eligibility_records
      ADD COLUMN qualifying_event_reference text
    `;

    await assert.rejects(
      migrateDatabase(sql, migrationsDirectory),
      (error: unknown) =>
        error instanceof MigrationSchemaDriftError &&
        error.migrationName === "003_eligibility_reward_workflow.sql" &&
        error.presentEffects.includes("eligibility_event_column") &&
        error.missingEffects.includes("qualifying_event_table"),
    );

    const [recorded] = await sql<{ name: string }[]>`
      SELECT name
      FROM schema_migrations
      WHERE name = '003_eligibility_reward_workflow.sql'
    `;
    assert.equal(recorded, undefined);
  });

  async function applyMigrationSql(name: string) {
    const migrationSql = await readFile(
      resolve(migrationsDirectory, name),
      "utf8",
    );
    await sql.unsafe(migrationSql);
  }

  async function createMigrationLedgerWith(names: string[]) {
    await sql`
      CREATE TABLE schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    for (const name of names) {
      const migrationSql = await readFile(
        resolve(migrationsDirectory, name),
        "utf8",
      );
      const checksum = createHash("sha256")
        .update(migrationSql, "utf8")
        .digest("hex");

      await sql`
        INSERT INTO schema_migrations (name, checksum)
        VALUES (${name}, ${checksum})
      `;
    }
  }
}

function assertDedicatedTestDatabase(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.slice(1);

  if (!/test/i.test(databaseName)) {
    throw new Error(
      "TEST_DATABASE_URL must point to a database whose name contains 'test'.",
    );
  }
}
