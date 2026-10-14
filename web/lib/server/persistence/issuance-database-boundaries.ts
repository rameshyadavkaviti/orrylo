import type postgres from "postgres";

import type { DatabaseClient } from "./database";

type DatabaseIdentityQueryClient = DatabaseClient | postgres.TransactionSql;

interface DatabaseIdentityRow {
  role_name: string;
  is_superuser: boolean;
  is_confirmation_writer: boolean;
  protected_namespace_count: number;
  protected_table_count: number;
  protected_function_count: number;
  owns_sensitive_schema: boolean;
  owns_sensitive_table: boolean;
  owns_sensitive_function: boolean;
  can_set_role_to_sensitive_owner: boolean;
  can_use_sensitive_owner: boolean;
  can_administer_sensitive_owner: boolean;
}

const EXPECTED_PROTECTED_TABLE_COUNT = 5;
const EXPECTED_PROTECTED_FUNCTION_COUNT = 8;

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
    identity.can_set_role_to_sensitive_owner ||
    identity.can_use_sensitive_owner ||
    identity.can_administer_sensitive_owner
  ) {
    throw new IssuanceDatabaseIdentityError(
      "The ordinary issuance repository requires a non-owner, non-superuser application identity without confirmation-writer authority or inherited, SET ROLE, or administrative authority over a sensitive owner.",
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
    identity.can_set_role_to_sensitive_owner ||
    identity.can_use_sensitive_owner ||
    identity.can_administer_sensitive_owner
  ) {
    throw new IssuanceDatabaseIdentityError(
      "The confirmation writer requires a dedicated non-owner, non-superuser identity with only trusted confirmation-writer authority and no inherited, SET ROLE, or administrative authority over a sensitive owner.",
    );
  }
}

async function readIdentity(
  sql: DatabaseIdentityQueryClient,
): Promise<DatabaseIdentityRow> {
  const [identity] = await sql<DatabaseIdentityRow[]>`
    WITH protected_namespace AS (
      SELECT namespace.oid, namespace.nspowner
      FROM pg_catalog.pg_namespace AS namespace
      WHERE namespace.nspname = 'public'
    ),
    protected_tables AS (
      SELECT relation.relname, relation.relowner
      FROM pg_catalog.pg_class AS relation
      JOIN protected_namespace
        ON protected_namespace.oid = relation.relnamespace
      WHERE relation.relkind IN ('r', 'p')
        AND relation.relname IN (
          'project_metadata_publications',
          'project_issuance_intents',
          'project_issuance_full_intents',
          'project_issuance_transaction_attempts',
          'project_issuance_ledger_confirmations'
        )
    ),
    protected_functions AS (
      SELECT procedure.proname, procedure.proowner
      FROM pg_catalog.pg_proc AS procedure
      JOIN protected_namespace
        ON protected_namespace.oid = procedure.pronamespace
      WHERE procedure.prokind = 'f'
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
    ),
    sensitive_roles AS (
      SELECT protected_namespace.nspowner AS role_oid
      FROM protected_namespace
      UNION
      SELECT protected_tables.relowner AS role_oid
      FROM protected_tables
      UNION
      SELECT protected_functions.proowner AS role_oid
      FROM protected_functions
      UNION
      SELECT sensitive_superuser.oid AS role_oid
      FROM pg_catalog.pg_roles AS sensitive_superuser
      WHERE sensitive_superuser.rolsuper
    )
    SELECT
      session_user AS role_name,
      role.rolsuper AS is_superuser,
      pg_catalog.pg_has_role(
        session_user,
        'orrylo_confirmation_writer',
        'MEMBER'
      )
        AS is_confirmation_writer,
      (SELECT count(*)::integer FROM protected_namespace)
        AS protected_namespace_count,
      (SELECT count(DISTINCT protected_tables.relname)::integer FROM protected_tables)
        AS protected_table_count,
      (SELECT count(DISTINCT protected_functions.proname)::integer FROM protected_functions)
        AS protected_function_count,
      EXISTS (
        SELECT 1
        FROM protected_namespace
        WHERE protected_namespace.nspowner = role.oid
      ) AS owns_sensitive_schema,
      EXISTS (
        SELECT 1
        FROM protected_tables
        WHERE protected_tables.relowner = role.oid
      ) AS owns_sensitive_table,
      EXISTS (
        SELECT 1
        FROM protected_functions
        WHERE protected_functions.proowner = role.oid
      ) AS owns_sensitive_function,
      EXISTS (
        SELECT 1
        FROM sensitive_roles
        WHERE sensitive_roles.role_oid <> role.oid
          AND pg_catalog.pg_has_role(
            session_user,
            sensitive_roles.role_oid,
            'SET'
          )
      ) AS can_set_role_to_sensitive_owner,
      EXISTS (
        SELECT 1
        FROM sensitive_roles
        WHERE sensitive_roles.role_oid <> role.oid
          AND pg_catalog.pg_has_role(
            session_user,
            sensitive_roles.role_oid,
            'USAGE'
          )
      ) AS can_use_sensitive_owner,
      EXISTS (
        SELECT 1
        FROM sensitive_roles
        WHERE sensitive_roles.role_oid <> role.oid
          AND pg_catalog.pg_has_role(
            session_user,
            sensitive_roles.role_oid,
            'MEMBER WITH ADMIN OPTION'
          )
      ) AS can_administer_sensitive_owner
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = session_user
  `;

  if (!identity) {
    throw new IssuanceDatabaseIdentityError(
      "Unable to verify the database identity.",
    );
  }
  if (
    identity.protected_namespace_count !== 1 ||
    identity.protected_table_count !== EXPECTED_PROTECTED_TABLE_COUNT ||
    identity.protected_function_count !== EXPECTED_PROTECTED_FUNCTION_COUNT
  ) {
    throw new IssuanceDatabaseIdentityError(
      "Unable to verify the complete protected public MVP schema ownership set.",
    );
  }
  return identity;
}
