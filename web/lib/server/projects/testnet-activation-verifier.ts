import type postgres from "postgres";

import type { DatabaseClient } from "../persistence/database";
import {
  assertSharedIssuanceApplicationDatabaseIdentity,
  assertTrustedConfirmationWriterDatabaseIdentity,
} from "../persistence/issuance-database-boundaries";
import {
  KNOWN_RYLO_ISSUER_PUBLIC_KEYS,
  SHARED_ISSUER_CANDIDATE,
  isKnownRyloIssuerPublicKey,
} from "../../product/constants";
import { OFFICIAL_STELLAR_TESTNET_HORIZON_URL } from "../../stellar/official-testnet-horizon";
import {
  SHARED_ISSUER_TESTNET_NETWORK,
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
} from "../../stellar/shared-issuer-issuance";
import {
  OfficialStellarTestnetIssuancePreflightReader,
  type SharedIssuerTestnetPreflightResult,
} from "../../stellar/shared-issuer-testnet-preflight";

export type TestnetActivationVerificationErrorCode =
  | "known_rylo_issuer"
  | "reserved_shared_issuer_candidate"
  | "database_privilege_mismatch";

export class TestnetActivationVerificationError extends Error {
  constructor(
    readonly code: TestnetActivationVerificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TestnetActivationVerificationError";
  }
}

export interface TestnetActivationVerificationInput {
  issuerPublicKey: string;
  signerPublicKey?: string;
  destinationPublicKey: string;
  assetCode: string;
  amount: string;
  feeStroops: string;
}

export interface TestnetActivationDatabaseReport {
  applicationRole: string;
  confirmationWriterRole: string;
  applicationCanInsertConfirmation: false;
  confirmationWriterCanInsertConfirmation: true;
  confirmationWriterCanReadConfirmation: true;
  confirmationWriterCanReadIntentAndAttempt: true;
  applicationCanSetRoleToSensitiveOwner: false;
  confirmationWriterCanSetRoleToSensitiveOwner: false;
  applicationReadOnlyTransactionVerified: true;
  confirmationWriterReadOnlyTransactionVerified: true;
}

export interface TestnetActivationVerificationReport {
  readOnly: true;
  network: typeof SHARED_ISSUER_TESTNET_NETWORK;
  networkPassphrase: typeof SHARED_ISSUER_TESTNET_PASSPHRASE;
  horizonUrl: typeof OFFICIAL_STELLAR_TESTNET_HORIZON_URL;
  issuer: {
    publicKey: string;
    knownRyloIdentity: false;
    reservedCandidate: false;
    policyVerified: true;
    currentSequence: string;
    spendableNativeStroops: string;
    configuredFeeStroops: string;
    baseFeeStroops: string;
    baseReserveStroops: string;
  };
  destination: {
    publicKey: string;
    assetCode: string;
    amount: string;
    trustlineExists: true;
    trustlineAuthorized: true;
    trustlineBalance: string;
    trustlineLimit: string;
    buyingLiabilities: string;
    capacityVerified: true;
  };
  observedLedger: number;
  observedLedgerClosedAt: string;
  database: TestnetActivationDatabaseReport;
}

export interface TestnetActivationVerifierDependencies {
  readPreflight(
    input: Parameters<
      OfficialStellarTestnetIssuancePreflightReader["readIssuancePreconditions"]
    >[0],
  ): Promise<SharedIssuerTestnetPreflightResult>;
  verifyDatabaseBoundaries(): Promise<TestnetActivationDatabaseReport>;
}

export async function verifyTestnetActivationReadiness(
  input: TestnetActivationVerificationInput,
  dependencies: TestnetActivationVerifierDependencies,
): Promise<TestnetActivationVerificationReport> {
  if (isKnownRyloIssuerPublicKey(input.issuerPublicKey)) {
    throw new TestnetActivationVerificationError(
      "known_rylo_issuer",
      "A known RYLO issuer identity cannot be activated as the customer Shared Issuer.",
    );
  }

  if (input.issuerPublicKey.trim().toUpperCase() === SHARED_ISSUER_CANDIDATE) {
    throw new TestnetActivationVerificationError(
      "reserved_shared_issuer_candidate",
      "The reserved Shared Issuer candidate is not approved for the bounded Testnet MVP activation.",
    );
  }

  const preflight = await dependencies.readPreflight({
    issuerPublicKey: input.issuerPublicKey,
    signerPublicKey: input.signerPublicKey,
    destinationPublicKey: input.destinationPublicKey,
    assetCode: input.assetCode,
    assetCodeReservedForProject: true,
    feeStroops: input.feeStroops,
  });

  if (
    preflight.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    preflight.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE
  ) {
    throw new Error("Read-only preflight returned an unexpected network.");
  }

  // This local construction performs no Stellar mutation. The reservation flag
  // is asserted only to exercise the same exact amount/trustline-capacity and
  // canonical transaction checks used by execution.
  const plan = buildSharedIssuerIssuancePlan(
    {
      projectId: "activation-readiness-verification",
      assetCode: input.assetCode,
      issuerPublicKey: input.issuerPublicKey,
      destinationPublicKey: input.destinationPublicKey,
      amount: input.amount,
      network: SHARED_ISSUER_TESTNET_NETWORK,
      networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
      validFrom: 1,
      validUntil: 2,
    },
    preflight.preconditions,
  );

  const trustline = preflight.preconditions.destinationTrustline;
  if (!trustline.exists || !trustline.authorized) {
    throw new Error("Destination trustline is not ready.");
  }

  const database = await dependencies.verifyDatabaseBoundaries();

  return {
    readOnly: true,
    network: SHARED_ISSUER_TESTNET_NETWORK,
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
    horizonUrl: OFFICIAL_STELLAR_TESTNET_HORIZON_URL,
    issuer: {
      publicKey: plan.intent.issuerPublicKey,
      knownRyloIdentity: false,
      reservedCandidate: false,
      policyVerified: true,
      currentSequence: preflight.preconditions.issuerSequence,
      spendableNativeStroops:
        preflight.preconditions.issuerSpendableNativeStroops,
      configuredFeeStroops: plan.feeStroops,
      baseFeeStroops: preflight.baseFeeStroops,
      baseReserveStroops: preflight.baseReserveStroops,
    },
    destination: {
      publicKey: plan.intent.destinationPublicKey,
      assetCode: plan.intent.assetCode,
      amount: plan.intent.amount,
      trustlineExists: true,
      trustlineAuthorized: true,
      trustlineBalance: trustline.balance,
      trustlineLimit: trustline.limit,
      buyingLiabilities: trustline.buyingLiabilities,
      capacityVerified: true,
    },
    observedLedger: preflight.observedLedger,
    observedLedgerClosedAt: preflight.observedLedgerClosedAt,
    database,
  };
}

export async function verifyTestnetActivationDatabaseBoundaries(
  applicationDatabase: DatabaseClient,
  confirmationWriterDatabase: DatabaseClient,
): Promise<TestnetActivationDatabaseReport> {
  const application = await applicationDatabase.begin(
    "read only",
    async (transaction) => {
      await assertSharedIssuanceApplicationDatabaseIdentity(transaction);
      return readActivationPrivileges(transaction);
    },
  );
  const writer = await confirmationWriterDatabase.begin(
    "read only",
    async (transaction) => {
      await assertTrustedConfirmationWriterDatabaseIdentity(transaction);
      return readActivationPrivileges(transaction);
    },
  );

  if (!application.transactionReadOnly || !writer.transactionReadOnly) {
    throw new TestnetActivationVerificationError(
      "database_privilege_mismatch",
      "Database activation inspection must run inside PostgreSQL READ ONLY transactions.",
    );
  }

  const applicationHasForbiddenConfirmationWriteAuthority =
    application.canInsertConfirmation ||
    application.canInsertAnyConfirmationColumn ||
    application.canUpdateConfirmation ||
    application.canDeleteConfirmation ||
    application.canTruncateConfirmation ||
    application.canUpdateAnyConfirmationColumn ||
    application.canSetRoleToForbiddenConfirmationAuthority;

  if (applicationHasForbiddenConfirmationWriteAuthority) {
    throw new TestnetActivationVerificationError(
      "database_privilege_mismatch",
      "The ordinary application database identity must not have write authority over authoritative confirmations.",
    );
  }

  const writerHasForbiddenConfirmationWriteAuthority =
    writer.canUpdateConfirmation ||
    writer.canDeleteConfirmation ||
    writer.canTruncateConfirmation ||
    writer.canUpdateAnyConfirmationColumn;

  const writerHasForbiddenEvidenceWriteAuthority =
    writer.canInsertFullIntent ||
    writer.canInsertAnyFullIntentColumn ||
    writer.canUpdateFullIntent ||
    writer.canDeleteFullIntent ||
    writer.canTruncateFullIntent ||
    writer.canUpdateAnyFullIntentColumn ||
    writer.canInsertAttempt ||
    writer.canInsertAnyAttemptColumn ||
    writer.canUpdateAttempt ||
    writer.canDeleteAttempt ||
    writer.canTruncateAttempt ||
    writer.canUpdateAnyAttemptColumn;

  if (
    !writer.canInsertConfirmation ||
    !writer.canReadConfirmation ||
    !writer.canReadFullIntent ||
    !writer.canReadAttempt ||
    writerHasForbiddenConfirmationWriteAuthority ||
    writerHasForbiddenEvidenceWriteAuthority
  ) {
    throw new TestnetActivationVerificationError(
      "database_privilege_mismatch",
      "The dedicated confirmation writer must have only confirmation INSERT/SELECT and prerequisite evidence SELECT authority, with no destructive confirmation authority or write authority over immutable intent or attempt evidence.",
    );
  }

  return {
    applicationRole: application.roleName,
    confirmationWriterRole: writer.roleName,
    applicationCanInsertConfirmation: false,
    confirmationWriterCanInsertConfirmation: true,
    confirmationWriterCanReadConfirmation: true,
    confirmationWriterCanReadIntentAndAttempt: true,
    applicationCanSetRoleToSensitiveOwner: false,
    confirmationWriterCanSetRoleToSensitiveOwner: false,
    applicationReadOnlyTransactionVerified: true,
    confirmationWriterReadOnlyTransactionVerified: true,
  };
}

interface ActivationPrivileges {
  roleName: string;
  canInsertConfirmation: boolean;
  canInsertAnyConfirmationColumn: boolean;
  canReadConfirmation: boolean;
  canUpdateConfirmation: boolean;
  canDeleteConfirmation: boolean;
  canTruncateConfirmation: boolean;
  canUpdateAnyConfirmationColumn: boolean;
  canSetRoleToForbiddenConfirmationAuthority: boolean;
  canReadFullIntent: boolean;
  canReadAttempt: boolean;
  canInsertFullIntent: boolean;
  canInsertAnyFullIntentColumn: boolean;
  canUpdateFullIntent: boolean;
  canDeleteFullIntent: boolean;
  canTruncateFullIntent: boolean;
  canUpdateAnyFullIntentColumn: boolean;
  canInsertAttempt: boolean;
  canInsertAnyAttemptColumn: boolean;
  canUpdateAttempt: boolean;
  canDeleteAttempt: boolean;
  canTruncateAttempt: boolean;
  canUpdateAnyAttemptColumn: boolean;
  transactionReadOnly: boolean;
}

async function readActivationPrivileges(
  sql: postgres.TransactionSql,
): Promise<ActivationPrivileges> {
  const [row] = await sql<
    {
      role_name: string;
      can_insert_confirmation: boolean;
      can_insert_any_confirmation_column: boolean;
      can_read_confirmation: boolean;
      can_update_confirmation: boolean;
      can_delete_confirmation: boolean;
      can_truncate_confirmation: boolean;
      can_update_any_confirmation_column: boolean;
      can_set_role_to_forbidden_confirmation_authority: boolean;
      can_read_full_intent: boolean;
      can_read_attempt: boolean;
      can_insert_full_intent: boolean;
      can_insert_any_full_intent_column: boolean;
      can_update_full_intent: boolean;
      can_delete_full_intent: boolean;
      can_truncate_full_intent: boolean;
      can_update_any_full_intent_column: boolean;
      can_insert_attempt: boolean;
      can_insert_any_attempt_column: boolean;
      can_update_attempt: boolean;
      can_delete_attempt: boolean;
      can_truncate_attempt: boolean;
      can_update_any_attempt_column: boolean;
      transaction_read_only: boolean;
    }[]
  >`
    SELECT
      current_user AS role_name,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_ledger_confirmations',
        'INSERT'
      ) AS can_insert_confirmation,
      pg_catalog.has_any_column_privilege(
        current_user,
        'public.project_issuance_ledger_confirmations',
        'INSERT'
      ) AS can_insert_any_confirmation_column,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_ledger_confirmations',
        'SELECT'
      ) AS can_read_confirmation,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_ledger_confirmations',
        'UPDATE'
      ) AS can_update_confirmation,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_ledger_confirmations',
        'DELETE'
      ) AS can_delete_confirmation,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_ledger_confirmations',
        'TRUNCATE'
      ) AS can_truncate_confirmation,
      pg_catalog.has_any_column_privilege(
        current_user,
        'public.project_issuance_ledger_confirmations',
        'UPDATE'
      ) AS can_update_any_confirmation_column,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS candidate_role
        WHERE candidate_role.rolname <> session_user
          AND pg_catalog.pg_has_role(
            session_user,
            candidate_role.oid,
            'SET'
          )
          AND (
            pg_catalog.has_table_privilege(
              candidate_role.oid,
              'public.project_issuance_ledger_confirmations',
              'INSERT'
            )
            OR pg_catalog.has_table_privilege(
              candidate_role.oid,
              'public.project_issuance_ledger_confirmations',
              'UPDATE'
            )
            OR pg_catalog.has_table_privilege(
              candidate_role.oid,
              'public.project_issuance_ledger_confirmations',
              'DELETE'
            )
            OR pg_catalog.has_table_privilege(
              candidate_role.oid,
              'public.project_issuance_ledger_confirmations',
              'TRUNCATE'
            )
            OR pg_catalog.has_any_column_privilege(
              candidate_role.oid,
              'public.project_issuance_ledger_confirmations',
              'INSERT'
            )
            OR pg_catalog.has_any_column_privilege(
              candidate_role.oid,
              'public.project_issuance_ledger_confirmations',
              'UPDATE'
            )
          )
      ) AS can_set_role_to_forbidden_confirmation_authority,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_full_intents',
        'SELECT'
      ) AS can_read_full_intent,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_transaction_attempts',
        'SELECT'
      ) AS can_read_attempt,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_full_intents',
        'INSERT'
      ) AS can_insert_full_intent,
      pg_catalog.has_any_column_privilege(
        current_user,
        'public.project_issuance_full_intents',
        'INSERT'
      ) AS can_insert_any_full_intent_column,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_full_intents',
        'UPDATE'
      ) AS can_update_full_intent,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_full_intents',
        'DELETE'
      ) AS can_delete_full_intent,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_full_intents',
        'TRUNCATE'
      ) AS can_truncate_full_intent,
      pg_catalog.has_any_column_privilege(
        current_user,
        'public.project_issuance_full_intents',
        'UPDATE'
      ) AS can_update_any_full_intent_column,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_transaction_attempts',
        'INSERT'
      ) AS can_insert_attempt,
      pg_catalog.has_any_column_privilege(
        current_user,
        'public.project_issuance_transaction_attempts',
        'INSERT'
      ) AS can_insert_any_attempt_column,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_transaction_attempts',
        'UPDATE'
      ) AS can_update_attempt,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_transaction_attempts',
        'DELETE'
      ) AS can_delete_attempt,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_transaction_attempts',
        'TRUNCATE'
      ) AS can_truncate_attempt,
      pg_catalog.has_any_column_privilege(
        current_user,
        'public.project_issuance_transaction_attempts',
        'UPDATE'
      ) AS can_update_any_attempt_column,
      current_setting('transaction_read_only') = 'on'
        AS transaction_read_only
  `;

  if (!row) {
    throw new TestnetActivationVerificationError(
      "database_privilege_mismatch",
      "Unable to inspect issuance database privileges.",
    );
  }

  return {
    roleName: row.role_name,
    canInsertConfirmation: row.can_insert_confirmation,
    canInsertAnyConfirmationColumn: row.can_insert_any_confirmation_column,
    canReadConfirmation: row.can_read_confirmation,
    canUpdateConfirmation: row.can_update_confirmation,
    canDeleteConfirmation: row.can_delete_confirmation,
    canTruncateConfirmation: row.can_truncate_confirmation,
    canUpdateAnyConfirmationColumn: row.can_update_any_confirmation_column,
    canSetRoleToForbiddenConfirmationAuthority:
      row.can_set_role_to_forbidden_confirmation_authority,
    canReadFullIntent: row.can_read_full_intent,
    canReadAttempt: row.can_read_attempt,
    canInsertFullIntent: row.can_insert_full_intent,
    canInsertAnyFullIntentColumn: row.can_insert_any_full_intent_column,
    canUpdateFullIntent: row.can_update_full_intent,
    canDeleteFullIntent: row.can_delete_full_intent,
    canTruncateFullIntent: row.can_truncate_full_intent,
    canUpdateAnyFullIntentColumn: row.can_update_any_full_intent_column,
    canInsertAttempt: row.can_insert_attempt,
    canInsertAnyAttemptColumn: row.can_insert_any_attempt_column,
    canUpdateAttempt: row.can_update_attempt,
    canDeleteAttempt: row.can_delete_attempt,
    canTruncateAttempt: row.can_truncate_attempt,
    canUpdateAnyAttemptColumn: row.can_update_any_attempt_column,
    transactionReadOnly: row.transaction_read_only,
  };
}

export function knownRyloIssuerIdentitiesForActivation(): readonly string[] {
  return KNOWN_RYLO_ISSUER_PUBLIC_KEYS;
}
