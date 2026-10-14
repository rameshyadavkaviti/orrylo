import type postgres from "postgres";

import type { DatabaseClient } from "./database";

type DatabaseIdentityQueryClient = DatabaseClient | postgres.TransactionSql;

interface DatabaseIdentityRow {
  role_name: string;
  is_superuser: boolean;
  is_confirmation_writer: boolean;
  owns_sensitive_schema: boolean;
  owns_sensitive_table: boolean;
  owns_sensitive_function: boolean;
  can_set_role_to_sensitive_owner: boolean;
}

export class IssuanceDatabaseIdentityError extends Error {
  readonly code = "issuance_database_identity_rejected";

  constructor(message: string) {
    super(message);
    this.name = "IssuanceDatabaseIdentityError";
  }
}

export class SharedIssuanceApplicationDatabaseBoundary {
  readonly #authorized = true;

  private constructor(readonly sql: DatabaseClient) {}

  static async authorize(
    sql: DatabaseClient,
  ): Promise<SharedIssuanceApplicationDatabaseBoundary> {
    await assertSharedIssuanceApplicationDatabaseIdentity(sql);
    return new SharedIssuanceApplicationDatabaseBoundary(sql);
  }

  assertAuthorized(): void {
    if (!this.#authorized)
      throw new IssuanceDatabaseIdentityError(
        "Invalid application database boundary.",
      );
  }
}

export class TrustedConfirmationWriterDatabaseBoundary {
  readonly #authorized = true;

  private constructor(readonly sql: DatabaseClient) {}

  static async authorize(
    sql: DatabaseClient,
  ): Promise<TrustedConfirmationWriterDatabaseBoundary> {
    await assertTrustedConfirmationWriterDatabaseIdentity(sql);
    return new TrustedConfirmationWriterDatabaseBoundary(sql);
  }

  assertAuthorized(): void {
    if (!this.#authorized)
      throw new IssuanceDatabaseIdentityError(
        "Invalid confirmation-writer database boundary.",
      );
  }
}

export async function assertSharedIssuanceApplicationDatabaseIdentity(
  sql: DatabaseIdentityQueryClient,
): Promise<void> {
  const identity = await readIdentity(sql);
  if (
    identity.is_superuser ||
    identity.is_confirmation_writer ||
    identity.owns_sensitive_schema ||
    identity.owns_sensitive_table ||
    identity.owns_sensitive_function ||
    identity.can_set_role_to_sensitive_owner
  ) {
    throw new IssuanceDatabaseIdentityError(
      "The ordinary issuance repository requires a non-owner, non-superuser application identity without confirmation-writer authority or SET ROLE access to a sensitive owner.",
    );
  }
}

export async function assertTrustedConfirmationWriterDatabaseIdentity(
  sql: DatabaseIdentityQueryClient,
): Promise<void> {
  const identity = await readIdentity(sql);
  if (
    identity.is_superuser ||
    !identity.is_confirmation_writer ||
    identity.owns_sensitive_schema ||
    identity.owns_sensitive_table ||
    identity.owns_sensitive_function ||
    identity.can_set_role_to_sensitive_owner
  ) {
    throw new IssuanceDatabaseIdentityError(
      "The confirmation writer requires a dedicated non-owner, non-superuser identity with only trusted confirmation-writer authority and no SET ROLE access to a sensitive owner.",
    );
  }
}

async function readIdentity(
  sql: DatabaseIdentityQueryClient,
): Promise<DatabaseIdentityRow> {
  const [identity] = await sql<DatabaseIdentityRow[]>`
    WITH sensitive_roles AS (
      SELECT namespace.nspowner AS role_oid
      FROM pg_catalog.pg_namespace AS namespace
      WHERE namespace.nspname = current_schema()
      UNION
      SELECT relation.relowner AS role_oid
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND relation.relname IN (
          'project_metadata_publications',
          'project_issuance_intents',
          'project_issuance_full_intents',
          'project_issuance_transaction_attempts',
          'project_issuance_ledger_confirmations'
        )
      UNION
      SELECT procedure.proowner AS role_oid
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = current_schema()
        AND procedure.proname IN (
          'prevent_issuance_identity_mutation',
          'prevent_issuance_workflow_fingerprint_mutation',
          'assert_issuance_reservation_workflow_link',
          'assert_issuance_attempt_matches_intent',
          'assert_trusted_confirmation_writer',
          'protect_issuance_transaction_attempt',
          'prevent_issuance_evidence_mutation',
          'assert_metadata_reachability_signed_confirmation'
        )
      UNION
      SELECT sensitive_superuser.oid AS role_oid
      FROM pg_catalog.pg_roles AS sensitive_superuser
      WHERE sensitive_superuser.rolsuper
    )
    SELECT
      session_user AS role_name,
      role.rolsuper AS is_superuser,
      pg_has_role(session_user, 'orrylo_confirmation_writer', 'MEMBER')
        AS is_confirmation_writer,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.nspname = current_schema()
          AND namespace.nspowner = role.oid
      ) AS owns_sensitive_schema,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = current_schema()
          AND relation.relname IN (
            'project_metadata_publications',
            'project_issuance_intents',
            'project_issuance_full_intents',
            'project_issuance_transaction_attempts',
            'project_issuance_ledger_confirmations'
          )
          AND relation.relowner = role.oid
      ) AS owns_sensitive_table,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = current_schema()
          AND procedure.proname IN (
            'prevent_issuance_identity_mutation',
            'prevent_issuance_workflow_fingerprint_mutation',
            'assert_issuance_reservation_workflow_link',
            'assert_issuance_attempt_matches_intent',
            'assert_trusted_confirmation_writer',
            'protect_issuance_transaction_attempt',
            'prevent_issuance_evidence_mutation',
            'assert_metadata_reachability_signed_confirmation'
          )
          AND procedure.proowner = role.oid
      ) AS owns_sensitive_function,
      EXISTS (
        SELECT 1
        FROM sensitive_roles
        WHERE sensitive_roles.role_oid <> role.oid
          AND pg_catalog.pg_has_role(
            role.oid,
            sensitive_roles.role_oid,
            'SET'
          )
      ) AS can_set_role_to_sensitive_owner
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = session_user
  `;

  if (!identity) {
    throw new IssuanceDatabaseIdentityError(
      "Unable to verify the database identity.",
    );
  }
  return identity;
}
