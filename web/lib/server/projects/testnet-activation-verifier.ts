import type { DatabaseClient } from "../persistence/database";
import {
  SharedIssuanceApplicationDatabaseBoundary,
  TrustedConfirmationWriterDatabaseBoundary,
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
  confirmationWriterCanReadIntentAndAttempt: true;
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
  await SharedIssuanceApplicationDatabaseBoundary.authorize(
    applicationDatabase,
  );
  await TrustedConfirmationWriterDatabaseBoundary.authorize(
    confirmationWriterDatabase,
  );

  const application = await readActivationPrivileges(applicationDatabase);
  const writer = await readActivationPrivileges(confirmationWriterDatabase);

  if (application.canInsertConfirmation) {
    throw new TestnetActivationVerificationError(
      "database_privilege_mismatch",
      "The ordinary application database identity must not be able to insert authoritative confirmations.",
    );
  }

  if (
    !writer.canInsertConfirmation ||
    !writer.canReadFullIntent ||
    !writer.canReadAttempt
  ) {
    throw new TestnetActivationVerificationError(
      "database_privilege_mismatch",
      "The dedicated confirmation writer is missing its narrow confirmation privileges.",
    );
  }

  return {
    applicationRole: application.roleName,
    confirmationWriterRole: writer.roleName,
    applicationCanInsertConfirmation: false,
    confirmationWriterCanInsertConfirmation: true,
    confirmationWriterCanReadIntentAndAttempt: true,
  };
}

interface ActivationPrivileges {
  roleName: string;
  canInsertConfirmation: boolean;
  canReadFullIntent: boolean;
  canReadAttempt: boolean;
}

async function readActivationPrivileges(
  sql: DatabaseClient,
): Promise<ActivationPrivileges> {
  const [row] = await sql<
    {
      role_name: string;
      can_insert_confirmation: boolean;
      can_read_full_intent: boolean;
      can_read_attempt: boolean;
    }[]
  >`
    SELECT
      current_user AS role_name,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_ledger_confirmations',
        'INSERT'
      ) AS can_insert_confirmation,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_full_intents',
        'SELECT'
      ) AS can_read_full_intent,
      pg_catalog.has_table_privilege(
        current_user,
        'public.project_issuance_transaction_attempts',
        'SELECT'
      ) AS can_read_attempt
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
    canReadFullIntent: row.can_read_full_intent,
    canReadAttempt: row.can_read_attempt,
  };
}

export function knownRyloIssuerIdentitiesForActivation(): readonly string[] {
  return KNOWN_RYLO_ISSUER_PUBLIC_KEYS;
}
