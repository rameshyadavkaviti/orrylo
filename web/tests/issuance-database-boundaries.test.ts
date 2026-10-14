import assert from "node:assert/strict";
import test from "node:test";

import type { DatabaseClient } from "../lib/server/persistence/database";
import {
  IssuanceDatabaseIdentityError,
  SharedIssuanceApplicationDatabaseBoundary,
  TrustedConfirmationWriterDatabaseBoundary,
} from "../lib/server/persistence/issuance-database-boundaries";

interface IdentityFixture {
  role_name: string;
  is_superuser: boolean;
  is_confirmation_writer: boolean;
  owns_sensitive_schema: boolean;
  owns_sensitive_table: boolean;
  owns_sensitive_function: boolean;
  can_set_role_to_sensitive_owner: boolean;
}

function identityDatabase(
  overrides: Partial<IdentityFixture> = {},
): DatabaseClient {
  const identity: IdentityFixture = {
    role_name: "orrylo_app",
    is_superuser: false,
    is_confirmation_writer: false,
    owns_sensitive_schema: false,
    owns_sensitive_table: false,
    owns_sensitive_function: false,
    can_set_role_to_sensitive_owner: false,
    ...overrides,
  };
  const sql = async () => [identity];
  return sql as unknown as DatabaseClient;
}

test("application identity rejects SET ROLE reachability to a sensitive owner", async () => {
  await assert.rejects(
    SharedIssuanceApplicationDatabaseBoundary.authorize(
      identityDatabase({ can_set_role_to_sensitive_owner: true }),
    ),
    IssuanceDatabaseIdentityError,
  );
});

test("application identity rejects direct ownership of the protected schema", async () => {
  await assert.rejects(
    SharedIssuanceApplicationDatabaseBoundary.authorize(
      identityDatabase({ owns_sensitive_schema: true }),
    ),
    IssuanceDatabaseIdentityError,
  );
});

test("confirmation writer rejects SET ROLE reachability to a sensitive owner", async () => {
  await assert.rejects(
    TrustedConfirmationWriterDatabaseBoundary.authorize(
      identityDatabase({
        role_name: "orrylo_confirmation_login",
        is_confirmation_writer: true,
        can_set_role_to_sensitive_owner: true,
      }),
    ),
    IssuanceDatabaseIdentityError,
  );
});
