import type { DatabaseClient } from "./database";

interface DatabaseIdentityRow {
  role_name: string;
  is_superuser: boolean;
  is_confirmation_writer: boolean;
  owns_sensitive_table: boolean;
  owns_sensitive_function: boolean;
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
    const identity = await readIdentity(sql);
    if (
      identity.is_superuser ||
      identity.is_confirmation_writer ||
      identity.owns_sensitive_table ||
      identity.owns_sensitive_function
    ) {
      throw new IssuanceDatabaseIdentityError(
        "The ordinary issuance repository requires a non-owner, non-superuser application identity without confirmation-writer authority.",
      );
    }
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
    const identity = await readIdentity(sql);
    if (
      identity.is_superuser ||
      !identity.is_confirmation_writer ||
      identity.owns_sensitive_table ||
      identity.owns_sensitive_function
    ) {
      throw new IssuanceDatabaseIdentityError(
        "The confirmation writer requires a dedicated non-owner, non-superuser identity with only trusted confirmation-writer authority.",
      );
    }
    return new TrustedConfirmationWriterDatabaseBoundary(sql);
  }

  assertAuthorized(): void {
    if (!this.#authorized)
      throw new IssuanceDatabaseIdentityError(
        "Invalid confirmation-writer database boundary.",
      );
  }
}

async function readIdentity(sql: DatabaseClient): Promise<DatabaseIdentityRow> {
  const [identity] = await sql<DatabaseIdentityRow[]>`
    SELECT
      current_user AS role_name,
      role.rolsuper AS is_superuser,
      pg_has_role(current_user, 'orrylo_confirmation_writer', 'MEMBER')
        AS is_confirmation_writer,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = current_schema()
          AND relation.relname IN (
            'project_issuance_full_intents',
            'project_issuance_transaction_attempts',
            'project_issuance_ledger_confirmations'
          )
          AND pg_get_userbyid(relation.relowner) = current_user
      ) AS owns_sensitive_table,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = current_schema()
          AND procedure.proname IN (
            'assert_issuance_attempt_matches_intent',
            'assert_trusted_confirmation_writer',
            'prevent_issuance_evidence_mutation'
          )
          AND pg_get_userbyid(procedure.proowner) = current_user
      ) AS owns_sensitive_function
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
  `;

  if (!identity) {
    throw new IssuanceDatabaseIdentityError(
      "Unable to verify the database identity.",
    );
  }
  return identity;
}
