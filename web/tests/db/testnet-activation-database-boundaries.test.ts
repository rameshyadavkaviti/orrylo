import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { createDatabaseClient } from "../../lib/server/persistence/database";
import { IssuanceDatabaseIdentityError } from "../../lib/server/persistence/issuance-database-boundaries";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import {
  TestnetActivationVerificationError,
  verifyTestnetActivationDatabaseBoundaries,
} from "../../lib/server/projects/testnet-activation-verifier";

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
      ALTER ROLE ${APP_ROLE} SET search_path TO pg_catalog, public;
      ALTER ROLE ${WRITER_ROLE} LOGIN INHERIT NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'activation-writer-test';
      ALTER ROLE ${WRITER_ROLE} SET search_path TO pg_catalog, public;
      ALTER ROLE ${SCHEMA_OWNER_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      ALTER ROLE ${BRIDGE_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      ALTER ROLE ${HARMLESS_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      ALTER SCHEMA public OWNER TO ${SCHEMA_OWNER_ROLE};
      GRANT USAGE ON SCHEMA public TO ${APP_ROLE}, ${WRITER_ROLE};
      GRANT orrylo_confirmation_writer TO ${WRITER_ROLE}
        WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
      GRANT ${HARMLESS_ROLE} TO ${APP_ROLE}
        WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
    `);
  });

  beforeEach(async () => {
    await admin.unsafe(`
      REVOKE ${SCHEMA_OWNER_ROLE} FROM ${APP_ROLE}, ${WRITER_ROLE}, ${BRIDGE_ROLE};
      REVOKE ${BRIDGE_ROLE} FROM ${APP_ROLE}, ${WRITER_ROLE};
      REVOKE ${HARMLESS_ROLE} FROM ${WRITER_ROLE}, ${BRIDGE_ROLE};
      REVOKE ADMIN OPTION FOR orrylo_confirmation_writer FROM ${WRITER_ROLE};
      GRANT orrylo_confirmation_writer TO ${WRITER_ROLE}
        WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
      REVOKE INSERT, UPDATE, DELETE, TRUNCATE
        ON project_issuance_full_intents,
          project_issuance_transaction_attempts
        FROM ${WRITER_ROLE}, ${BRIDGE_ROLE}, ${HARMLESS_ROLE};
      REVOKE UPDATE, DELETE, TRUNCATE
        ON project_issuance_ledger_confirmations
        FROM ${WRITER_ROLE}, ${BRIDGE_ROLE}, ${HARMLESS_ROLE};
      REVOKE INSERT (issuance_request_id)
        ON project_issuance_full_intents
        FROM ${WRITER_ROLE};
      REVOKE INSERT (signed_envelope_xdr_sha256)
        ON project_issuance_transaction_attempts
        FROM ${WRITER_ROLE};
      REVOKE UPDATE (signed_envelope_xdr_sha256)
        ON project_issuance_transaction_attempts
        FROM ${WRITER_ROLE};
      REVOKE UPDATE (result_xdr_sha256)
        ON project_issuance_ledger_confirmations
        FROM ${WRITER_ROLE};
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
    const [{ current_schema: applicationCurrentSchema }] = await app<
      { current_schema: string }[]
    >`
      SELECT current_schema()
    `;
    const [{ current_schema: writerCurrentSchema }] = await writer<
      { current_schema: string }[]
    >`
      SELECT current_schema()
    `;
    assert.equal(applicationCurrentSchema, "pg_catalog");
    assert.equal(writerCurrentSchema, "pg_catalog");
    const [
      { writer_can_admin_confirmation_role: writerCanAdminConfirmationRole },
    ] = await writer<{ writer_can_admin_confirmation_role: boolean }[]>`
        SELECT pg_catalog.pg_has_role(
          session_user,
          'orrylo_confirmation_writer',
          'MEMBER WITH ADMIN OPTION'
        ) AS writer_can_admin_confirmation_role
      `;
    assert.equal(writerCanAdminConfirmationRole, false);
    const [{ writer_can_set_confirmation_role: writerCanSetConfirmationRole }] =
      await writer<{ writer_can_set_confirmation_role: boolean }[]>`
        SELECT pg_catalog.pg_has_role(
          session_user,
          'orrylo_confirmation_writer',
          'SET'
        ) AS writer_can_set_confirmation_role
      `;
    assert.equal(writerCanSetConfirmationRole, true);

    const report = await verifyTestnetActivationDatabaseBoundaries(app, writer);

    assert.equal(report.applicationRole, APP_ROLE);
    assert.equal(report.confirmationWriterRole, WRITER_ROLE);
    assert.equal(report.applicationCanSetRoleToSensitiveOwner, false);
    assert.equal(report.confirmationWriterCanSetRoleToSensitiveOwner, false);
    assert.equal(report.confirmationWriterCanInsertConfirmation, true);
    assert.equal(report.confirmationWriterCanReadConfirmation, true);
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

  test("application login with inherited schema-owner authority and no SET access fails closed", async () => {
    await admin.unsafe(`
      GRANT ${SCHEMA_OWNER_ROLE} TO ${APP_ROLE}
        WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
    `);

    const [
      {
        can_use_schema_owner: canUseSchemaOwner,
        can_set_schema_owner: canSetSchemaOwner,
      },
    ] = await app<
      {
        can_use_schema_owner: boolean;
        can_set_schema_owner: boolean;
      }[]
    >`
        SELECT
          pg_catalog.pg_has_role(
            session_user,
            ${SCHEMA_OWNER_ROLE},
            'USAGE'
          ) AS can_use_schema_owner,
          pg_catalog.pg_has_role(
            session_user,
            ${SCHEMA_OWNER_ROLE},
            'SET'
          ) AS can_set_schema_owner
      `;
    assert.equal(canUseSchemaOwner, true);
    assert.equal(canSetSchemaOwner, false);

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("confirmation-writer login with administrable schema-owner membership and no SET access fails closed", async () => {
    await admin.unsafe(`
      GRANT ${SCHEMA_OWNER_ROLE} TO ${WRITER_ROLE}
        WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    `);

    const [
      {
        can_administer_schema_owner: canAdministerSchemaOwner,
        can_set_schema_owner: canSetSchemaOwner,
      },
    ] = await writer<
      {
        can_administer_schema_owner: boolean;
        can_set_schema_owner: boolean;
      }[]
    >`
        SELECT
          pg_catalog.pg_has_role(
            session_user,
            ${SCHEMA_OWNER_ROLE},
            'MEMBER WITH ADMIN OPTION'
          ) AS can_administer_schema_owner,
          pg_catalog.pg_has_role(
            session_user,
            ${SCHEMA_OWNER_ROLE},
            'SET'
          ) AS can_set_schema_owner
      `;
    assert.equal(canAdministerSchemaOwner, true);
    assert.equal(canSetSchemaOwner, false);

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("application login with ADMIN on an owner-reachable bridge fails even when direct sensitive-owner predicates are false", async () => {
    await admin.unsafe(`
      GRANT ${SCHEMA_OWNER_ROLE} TO ${BRIDGE_ROLE}
        WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
      GRANT ${BRIDGE_ROLE} TO ${APP_ROLE}
        WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    `);

    const [authority] = await app<
      {
        can_set_schema_owner: boolean;
        can_use_schema_owner: boolean;
        can_administer_schema_owner: boolean;
        can_administer_bridge: boolean;
      }[]
    >`
      SELECT
        pg_catalog.pg_has_role(
          session_user,
          ${SCHEMA_OWNER_ROLE},
          'SET'
        ) AS can_set_schema_owner,
        pg_catalog.pg_has_role(
          session_user,
          ${SCHEMA_OWNER_ROLE},
          'USAGE'
        ) AS can_use_schema_owner,
        pg_catalog.pg_has_role(
          session_user,
          ${SCHEMA_OWNER_ROLE},
          'MEMBER WITH ADMIN OPTION'
        ) AS can_administer_schema_owner,
        pg_catalog.pg_has_role(
          session_user,
          ${BRIDGE_ROLE},
          'MEMBER WITH ADMIN OPTION'
        ) AS can_administer_bridge
    `;
    assert.deepEqual(authority, {
      can_set_schema_owner: false,
      can_use_schema_owner: false,
      can_administer_schema_owner: false,
      can_administer_bridge: true,
    });

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("confirmation writer with ADMIN on an owner-reachable bridge fails even when direct sensitive-owner predicates are false", async () => {
    await admin.unsafe(`
      GRANT ${SCHEMA_OWNER_ROLE} TO ${BRIDGE_ROLE}
        WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
      GRANT ${BRIDGE_ROLE} TO ${WRITER_ROLE}
        WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    `);

    const [authority] = await writer<
      {
        can_set_schema_owner: boolean;
        can_use_schema_owner: boolean;
        can_administer_schema_owner: boolean;
        can_administer_bridge: boolean;
      }[]
    >`
      SELECT
        pg_catalog.pg_has_role(
          session_user,
          ${SCHEMA_OWNER_ROLE},
          'SET'
        ) AS can_set_schema_owner,
        pg_catalog.pg_has_role(
          session_user,
          ${SCHEMA_OWNER_ROLE},
          'USAGE'
        ) AS can_use_schema_owner,
        pg_catalog.pg_has_role(
          session_user,
          ${SCHEMA_OWNER_ROLE},
          'MEMBER WITH ADMIN OPTION'
        ) AS can_administer_schema_owner,
        pg_catalog.pg_has_role(
          session_user,
          ${BRIDGE_ROLE},
          'MEMBER WITH ADMIN OPTION'
        ) AS can_administer_bridge
    `;
    assert.deepEqual(authority, {
      can_set_schema_owner: false,
      can_use_schema_owner: false,
      can_administer_schema_owner: false,
      can_administer_bridge: true,
    });

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("confirmation writer with ADMIN OPTION on the trusted writer role fails closed", async () => {
    await admin.unsafe(`
      GRANT orrylo_confirmation_writer TO ${WRITER_ROLE}
        WITH ADMIN TRUE, INHERIT TRUE, SET TRUE;
    `);

    const [
      { can_administer_confirmation_role: canAdministerConfirmationRole },
    ] = await writer<{ can_administer_confirmation_role: boolean }[]>`
        SELECT pg_catalog.pg_has_role(
          session_user,
          'orrylo_confirmation_writer',
          'MEMBER WITH ADMIN OPTION'
        ) AS can_administer_confirmation_role
      `;
    assert.equal(canAdministerConfirmationRole, true);

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("confirmation writer rejects a harmless unexpected SET-reachable helper role", async () => {
    await admin.unsafe(`
      GRANT ${HARMLESS_ROLE} TO ${WRITER_ROLE}
        WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
    `);

    const [{ can_set_harmless_role: canSetHarmlessRole }] = await writer<
      { can_set_harmless_role: boolean }[]
    >`
      SELECT pg_catalog.pg_has_role(
        session_user,
        ${HARMLESS_ROLE},
        'SET'
      ) AS can_set_harmless_role
    `;
    assert.equal(canSetHarmlessRole, true);

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("confirmation writer rejects a SET-reachable helper carrying evidence INSERT", async () => {
    await admin.unsafe(`
      GRANT INSERT ON project_issuance_transaction_attempts
        TO ${HARMLESS_ROLE};
      GRANT ${HARMLESS_ROLE} TO ${WRITER_ROLE}
        WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
    `);

    const [
      {
        writer_can_insert_attempt: writerCanInsertAttempt,
        helper_can_insert_attempt: helperCanInsertAttempt,
        writer_can_set_helper: writerCanSetHelper,
      },
    ] = await writer<
      {
        writer_can_insert_attempt: boolean;
        helper_can_insert_attempt: boolean;
        writer_can_set_helper: boolean;
      }[]
    >`
      SELECT
        pg_catalog.has_table_privilege(
          current_user,
          'public.project_issuance_transaction_attempts',
          'INSERT'
        ) AS writer_can_insert_attempt,
        pg_catalog.has_table_privilege(
          ${HARMLESS_ROLE},
          'public.project_issuance_transaction_attempts',
          'INSERT'
        ) AS helper_can_insert_attempt,
        pg_catalog.pg_has_role(
          session_user,
          ${HARMLESS_ROLE},
          'SET'
        ) AS writer_can_set_helper
    `;
    assert.deepEqual(
      {
        writerCanInsertAttempt,
        helperCanInsertAttempt,
        writerCanSetHelper,
      },
      {
        writerCanInsertAttempt: false,
        helperCanInsertAttempt: true,
        writerCanSetHelper: true,
      },
    );

    await assert.rejects(
      verifyTestnetActivationDatabaseBoundaries(app, writer),
      IssuanceDatabaseIdentityError,
    );
  });

  test("confirmation writer rejects a nested unexpected SET-reachable role chain", async () => {
    await admin.unsafe(`
      GRANT ${HARMLESS_ROLE} TO ${BRIDGE_ROLE}
        WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
      GRANT ${BRIDGE_ROLE} TO ${WRITER_ROLE}
        WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
    `);

    const [
      {
        can_set_bridge_role: canSetBridgeRole,
        can_set_nested_harmless_role: canSetNestedHarmlessRole,
      },
    ] = await writer<
      {
        can_set_bridge_role: boolean;
        can_set_nested_harmless_role: boolean;
      }[]
    >`
      SELECT
        pg_catalog.pg_has_role(
          session_user,
          ${BRIDGE_ROLE},
          'SET'
        ) AS can_set_bridge_role,
        pg_catalog.pg_has_role(
          session_user,
          ${HARMLESS_ROLE},
          'SET'
        ) AS can_set_nested_harmless_role
    `;
    assert.equal(canSetBridgeRole, true);
    assert.equal(canSetNestedHarmlessRole, true);

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

  test("confirmation writer rejects destructive table-level confirmation privileges", async (t) => {
    for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"] as const) {
      await t.test(`${privilege} on confirmations fails closed`, async () => {
        await admin.unsafe(
          `GRANT ${privilege} ON project_issuance_ledger_confirmations TO ${WRITER_ROLE}`,
        );
        try {
          await assert.rejects(
            verifyTestnetActivationDatabaseBoundaries(app, writer),
            (error: unknown) =>
              error instanceof TestnetActivationVerificationError &&
              error.code === "database_privilege_mismatch",
          );
        } finally {
          await admin.unsafe(
            `REVOKE ${privilege} ON project_issuance_ledger_confirmations FROM ${WRITER_ROLE}`,
          );
        }
      });
    }
  });

  test("confirmation writer rejects column-only UPDATE on confirmation evidence", async () => {
    await admin.unsafe(`
      GRANT UPDATE (result_xdr_sha256)
        ON project_issuance_ledger_confirmations
        TO ${WRITER_ROLE};
    `);

    try {
      const [
        {
          can_update_confirmation_table: canUpdateConfirmationTable,
          can_update_confirmation_column: canUpdateConfirmationColumn,
        },
      ] = await writer<
        {
          can_update_confirmation_table: boolean;
          can_update_confirmation_column: boolean;
        }[]
      >`
        SELECT
          pg_catalog.has_table_privilege(
            current_user,
            'public.project_issuance_ledger_confirmations',
            'UPDATE'
          ) AS can_update_confirmation_table,
          pg_catalog.has_column_privilege(
            current_user,
            'public.project_issuance_ledger_confirmations',
            'result_xdr_sha256',
            'UPDATE'
          ) AS can_update_confirmation_column
      `;
      assert.equal(canUpdateConfirmationTable, false);
      assert.equal(canUpdateConfirmationColumn, true);

      await assert.rejects(
        verifyTestnetActivationDatabaseBoundaries(app, writer),
        (error: unknown) =>
          error instanceof TestnetActivationVerificationError &&
          error.code === "database_privilege_mismatch",
      );
    } finally {
      await admin.unsafe(`
        REVOKE UPDATE (result_xdr_sha256)
          ON project_issuance_ledger_confirmations
          FROM ${WRITER_ROLE};
      `);
    }
  });

  test("confirmation writer rejects forbidden table-level writes on immutable evidence", async (t) => {
    const cases = [
      ["project_issuance_full_intents", "INSERT"],
      ["project_issuance_transaction_attempts", "INSERT"],
      ["project_issuance_full_intents", "UPDATE"],
      ["project_issuance_transaction_attempts", "UPDATE"],
      ["project_issuance_full_intents", "DELETE"],
      ["project_issuance_transaction_attempts", "DELETE"],
      ["project_issuance_full_intents", "TRUNCATE"],
      ["project_issuance_transaction_attempts", "TRUNCATE"],
    ] as const;

    for (const [tableName, privilege] of cases) {
      await t.test(`${privilege} on ${tableName} fails closed`, async () => {
        await admin.unsafe(
          `GRANT ${privilege} ON ${tableName} TO ${WRITER_ROLE}`,
        );
        try {
          await assert.rejects(
            verifyTestnetActivationDatabaseBoundaries(app, writer),
            (error: unknown) =>
              error instanceof TestnetActivationVerificationError &&
              error.code === "database_privilege_mismatch",
          );
        } finally {
          await admin.unsafe(
            `REVOKE ${privilege} ON ${tableName} FROM ${WRITER_ROLE}`,
          );
        }
      });
    }
  });

  test("confirmation writer rejects column-only INSERT on full intent evidence", async () => {
    await admin.unsafe(`
      GRANT INSERT (issuance_request_id)
        ON project_issuance_full_intents
        TO ${WRITER_ROLE};
    `);

    try {
      const [
        {
          can_insert_full_intent_table: canInsertFullIntentTable,
          can_insert_full_intent_column: canInsertFullIntentColumn,
        },
      ] = await writer<
        {
          can_insert_full_intent_table: boolean;
          can_insert_full_intent_column: boolean;
        }[]
      >`
        SELECT
          pg_catalog.has_table_privilege(
            current_user,
            'public.project_issuance_full_intents',
            'INSERT'
          ) AS can_insert_full_intent_table,
          pg_catalog.has_column_privilege(
            current_user,
            'public.project_issuance_full_intents',
            'issuance_request_id',
            'INSERT'
          ) AS can_insert_full_intent_column
      `;
      assert.equal(canInsertFullIntentTable, false);
      assert.equal(canInsertFullIntentColumn, true);

      await assert.rejects(
        verifyTestnetActivationDatabaseBoundaries(app, writer),
        (error: unknown) =>
          error instanceof TestnetActivationVerificationError &&
          error.code === "database_privilege_mismatch",
      );
    } finally {
      await admin.unsafe(`
        REVOKE INSERT (issuance_request_id)
          ON project_issuance_full_intents
          FROM ${WRITER_ROLE};
      `);
    }
  });

  test("confirmation writer rejects column-only INSERT on signed-envelope attempt evidence", async () => {
    await admin.unsafe(`
      GRANT INSERT (signed_envelope_xdr_sha256)
        ON project_issuance_transaction_attempts
        TO ${WRITER_ROLE};
    `);

    try {
      const [
        {
          can_insert_attempt_table: canInsertAttemptTable,
          can_insert_attempt_column: canInsertAttemptColumn,
        },
      ] = await writer<
        {
          can_insert_attempt_table: boolean;
          can_insert_attempt_column: boolean;
        }[]
      >`
        SELECT
          pg_catalog.has_table_privilege(
            current_user,
            'public.project_issuance_transaction_attempts',
            'INSERT'
          ) AS can_insert_attempt_table,
          pg_catalog.has_column_privilege(
            current_user,
            'public.project_issuance_transaction_attempts',
            'signed_envelope_xdr_sha256',
            'INSERT'
          ) AS can_insert_attempt_column
      `;
      assert.equal(canInsertAttemptTable, false);
      assert.equal(canInsertAttemptColumn, true);

      await assert.rejects(
        verifyTestnetActivationDatabaseBoundaries(app, writer),
        (error: unknown) =>
          error instanceof TestnetActivationVerificationError &&
          error.code === "database_privilege_mismatch",
      );
    } finally {
      await admin.unsafe(`
        REVOKE INSERT (signed_envelope_xdr_sha256)
          ON project_issuance_transaction_attempts
          FROM ${WRITER_ROLE};
      `);
    }
  });

  test("confirmation writer rejects column-level signed-envelope UPDATE authority", async () => {
    await admin.unsafe(`
      GRANT UPDATE (signed_envelope_xdr_sha256)
        ON project_issuance_transaction_attempts
        TO ${WRITER_ROLE};
    `);

    try {
      const [
        {
          can_update_attempt_table: canUpdateAttemptTable,
          can_update_attempt_column: canUpdateAttemptColumn,
        },
      ] = await writer<
        {
          can_update_attempt_table: boolean;
          can_update_attempt_column: boolean;
        }[]
      >`
        SELECT
          pg_catalog.has_table_privilege(
            current_user,
            'public.project_issuance_transaction_attempts',
            'UPDATE'
          ) AS can_update_attempt_table,
          pg_catalog.has_column_privilege(
            current_user,
            'public.project_issuance_transaction_attempts',
            'signed_envelope_xdr_sha256',
            'UPDATE'
          ) AS can_update_attempt_column
      `;
      assert.equal(canUpdateAttemptTable, false);
      assert.equal(canUpdateAttemptColumn, true);

      await assert.rejects(
        verifyTestnetActivationDatabaseBoundaries(app, writer),
        (error: unknown) =>
          error instanceof TestnetActivationVerificationError &&
          error.code === "database_privilege_mismatch",
      );
    } finally {
      await admin.unsafe(`
        REVOKE UPDATE (signed_envelope_xdr_sha256)
          ON project_issuance_transaction_attempts
          FROM ${WRITER_ROLE};
      `);
    }
  });
}

function roleUrl(source: string, username: string, password: string): string {
  const url = new URL(source);
  url.username = username;
  url.password = password;
  return url.toString();
}
