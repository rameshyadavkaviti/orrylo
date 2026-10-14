import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import { IssuanceDatabaseIdentityError } from "../../lib/server/persistence/issuance-database-boundaries";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { verifyTestnetActivationDatabaseBoundaries } from "../../lib/server/projects/testnet-activation-verifier";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

const APP_ROLE = "orrylo_activation_app_test";
const WRITER_ROLE = "orrylo_activation_writer_test";
const SCHEMA_OWNER_ROLE = "orrylo_activation_schema_owner_test";
const BRIDGE_ROLE = "orrylo_activation_bridge_test";
const HARMLESS_ROLE = "orrylo_activation_harmless_test";

if (!TEST_DATABASE_URL) {
  test("Testnet activation database-boundary PostgreSQL suite", {
    skip: true,
  });
} else {
  const admin = createDatabaseClient(TEST_DATABASE_URL);
  const app = createDatabaseClient(
    roleUrl(TEST_DATABASE_URL, APP_ROLE, "activation-app-test"),
  );
  const writer = createDatabaseClient(
    roleUrl(TEST_DATABASE_URL, WRITER_ROLE, "activation-writer-test"),
  );

  before(async () => {
    if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname.slice(1))) {
      throw new Error(
        "TEST_DATABASE_URL must identify an isolated test database.",
      );
    }

    await admin.unsafe("DROP SCHEMA public CASCADE");
    await admin.unsafe("CREATE SCHEMA public");
    await migrateDatabase(admin, resolve(process.cwd(), "db/migrations"));
    await admin.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN NOINHERIT PASSWORD 'activation-app-test';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${WRITER_ROLE}') THEN
          CREATE ROLE ${WRITER_ROLE} LOGIN INHERIT PASSWORD 'activation-writer-test';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${SCHEMA_OWNER_ROLE}') THEN
          CREATE ROLE ${SCHEMA_OWNER_ROLE} NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${BRIDGE_ROLE}') THEN
          CREATE ROLE ${BRIDGE_ROLE} NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${HARMLESS_ROLE}') THEN
          CREATE ROLE ${HARMLESS_ROLE} NOLOGIN;
        END IF;
      END;
      $$;
      ALTER ROLE ${APP_ROLE} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'activation-app-test';
      ALTER ROLE ${WRITER_ROLE} LOGIN INHERIT NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'activation-writer-test';
      ALTER ROLE ${SCHEMA_OWNER_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      ALTER ROLE ${BRIDGE_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      ALTER ROLE ${HARMLESS_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      ALTER SCHEMA public OWNER TO ${SCHEMA_OWNER_ROLE};
      GRANT USAGE ON SCHEMA public TO ${APP_ROLE}, ${WRITER_ROLE};
      GRANT orrylo_confirmation_writer TO ${WRITER_ROLE}
        WITH INHERIT TRUE, SET TRUE;
      GRANT ${HARMLESS_ROLE} TO ${APP_ROLE}
        WITH INHERIT FALSE, SET TRUE;
    `);
  });

  beforeEach(async () => {
    await admin.unsafe(`
      REVOKE ${SCHEMA_OWNER_ROLE} FROM ${APP_ROLE}, ${WRITER_ROLE}, ${BRIDGE_ROLE};
      REVOKE ${BRIDGE_ROLE} FROM ${APP_ROLE}, ${WRITER_ROLE};
    `);
  });

  after(async () => {
    await Promise.all([app.end({ timeout: 5 }), writer.end({ timeout: 5 })]);
    await admin.unsafe(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      DROP ROLE IF EXISTS ${APP_ROLE};
      DROP ROLE IF EXISTS ${WRITER_ROLE};
      DROP ROLE IF EXISTS ${BRIDGE_ROLE};
      DROP ROLE IF EXISTS ${HARMLESS_ROLE};
      DROP ROLE IF EXISTS ${SCHEMA_OWNER_ROLE};
    `);
    await admin.end({ timeout: 5 });
  });

  test("normal application and bounded confirmation-writer roles pass in READ ONLY transactions", async () => {
    const report = await verifyTestnetActivationDatabaseBoundaries(app, writer);

    assert.equal(report.applicationRole, APP_ROLE);
    assert.equal(report.confirmationWriterRole, WRITER_ROLE);
    assert.equal(report.applicationCanSetRoleToSensitiveOwner, false);
    assert.equal(report.confirmationWriterCanSetRoleToSensitiveOwner, false);
    assert.equal(report.applicationReadOnlyTransactionVerified, true);
    assert.equal(report.confirmationWriterReadOnlyTransactionVerified, true);
  });

  test("SET-capable membership in a harmless role does not create a false failure", async () => {
    const [{ can_set_harmless_role: canSetHarmlessRole }] = await app<
      { can_set_harmless_role: boolean }[]
    >`
      SELECT pg_has_role(
        session_user,
        ${HARMLESS_ROLE},
        'SET'
      ) AS can_set_harmless_role
    `;
    assert.equal(canSetHarmlessRole, true);

    await verifyTestnetActivationDatabaseBoundaries(app, writer);
  });

  test("NOINHERIT application login with direct SET TRUE access to the schema owner fails closed", async () => {
    await admin.unsafe(`
      GRANT ${SCHEMA_OWNER_ROLE} TO ${APP_ROLE}
        WITH INHERIT FALSE, SET TRUE;
    `);

    const [membership] = await admin<
      {
        login_inherits: boolean;
        membership_inherits: boolean;
        membership_allows_set: boolean;
      }[]
    >`
      SELECT login.rolinherit AS login_inherits,
        membership.inherit_option AS membership_inherits,
        membership.set_option AS membership_allows_set
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS granted
        ON granted.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS login
        ON login.oid = membership.member
      WHERE granted.rolname = ${SCHEMA_OWNER_ROLE}
        AND login.rolname = ${APP_ROLE}
    `;
    assert.deepEqual(membership, {
      login_inherits: false,
      membership_inherits: false,
      membership_allows_set: true,
    });

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("confirmation-writer login with direct SET TRUE access to the schema owner fails closed", async () => {
    await admin.unsafe(`
      GRANT ${SCHEMA_OWNER_ROLE} TO ${WRITER_ROLE}
        WITH INHERIT FALSE, SET TRUE;
    `);

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("nested SET TRUE membership path to the schema owner fails closed", async () => {
    await admin.unsafe(`
      GRANT ${SCHEMA_OWNER_ROLE} TO ${BRIDGE_ROLE}
        WITH INHERIT FALSE, SET TRUE;
      GRANT ${BRIDGE_ROLE} TO ${APP_ROLE}
        WITH INHERIT FALSE, SET TRUE;
    `);

    const [{ can_set_schema_owner: canSetSchemaOwner }] = await app<
      { can_set_schema_owner: boolean }[]
    >`
      SELECT pg_has_role(
        session_user,
        ${SCHEMA_OWNER_ROLE},
        'SET'
      ) AS can_set_schema_owner
    `;
    assert.equal(canSetSchemaOwner, true);

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });
}

function roleUrl(source: string, username: string, password: string): string {
  const url = new URL(source);
  url.username = username;
  url.password = password;
  return url.toString();
}
