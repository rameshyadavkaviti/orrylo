import {
  createDatabaseClient,
  getDatabaseClient,
} from "../persistence/database";
import {
  SharedIssuanceApplicationDatabaseBoundary,
  TrustedConfirmationWriterDatabaseBoundary,
} from "../persistence/issuance-database-boundaries";
import { PostgresTrustedLedgerConfirmationWriter } from "./shared-issuance-persistence";
import { PostgresSharedIssuanceOrchestrationStore } from "./shared-issuance-orchestration-store";
import { SharedIssuanceOrchestrator } from "./shared-issuance-orchestrator";
import {
  OfficialStellarTestnetHorizonReader,
  OfficialStellarTestnetHorizonSubmissionAdapter,
} from "../../stellar/official-testnet-horizon";
import { createSharedIssuerMvpLiteSignerAuthorization } from "../../stellar/shared-issuer-signing-policy";
import type { SharedIssuerSigningPrimitive } from "../../stellar/shared-issuer-signing-policy";
import { OfficialStellarTestnetIssuancePreflightReader } from "../../stellar/shared-issuer-testnet-preflight";
import { AuthoritativeSharedIssuanceConfirmationValidator } from "../../stellar/testnet-ledger-confirmation";
import type { DatabaseClient } from "../persistence/database";

export class SharedIssuanceRuntimeUnavailableError extends Error {
  readonly code = "issuer_integration_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "SharedIssuanceRuntimeUnavailableError";
  }
}

/**
 * The single server composition point for the #46 intent, #32 persistence and
 * #54 Stellar stack. The signing primitive remains a required injected
 * operational dependency; this module never loads or stores signer secrets.
 */
export async function createServerSharedIssuanceOrchestrator(input: {
  primitive: SharedIssuerSigningPrimitive;
  issuerPublicKey: string;
  feeStroops: string;
  confirmationWriterDatabaseUrl: string;
  applicationDatabase?: DatabaseClient;
  confirmationWriterDatabase?: DatabaseClient;
}) {
  if (!input.confirmationWriterDatabaseUrl.trim()) {
    throw new SharedIssuanceRuntimeUnavailableError(
      "A dedicated confirmation-writer database credential is required.",
    );
  }
  const applicationDatabase = input.applicationDatabase ?? getDatabaseClient();
  const confirmationDatabase =
    input.confirmationWriterDatabase ??
    createDatabaseClient(input.confirmationWriterDatabaseUrl);
  const applicationBoundary =
    await SharedIssuanceApplicationDatabaseBoundary.authorize(
      applicationDatabase,
    );
  const confirmationBoundary =
    await TrustedConfirmationWriterDatabaseBoundary.authorize(
      confirmationDatabase,
    );
  const reader = new OfficialStellarTestnetHorizonReader();

  return new SharedIssuanceOrchestrator({
    store: new PostgresSharedIssuanceOrchestrationStore(applicationBoundary),
    preflight: new OfficialStellarTestnetIssuancePreflightReader(),
    primitive: input.primitive,
    submission: new OfficialStellarTestnetHorizonSubmissionAdapter(),
    authorization: createSharedIssuerMvpLiteSignerAuthorization(
      input.issuerPublicKey,
    ),
    confirmationValidator: new AuthoritativeSharedIssuanceConfirmationValidator(
      reader,
    ),
    confirmationWriter: new PostgresTrustedLedgerConfirmationWriter(
      confirmationBoundary,
    ),
    feeStroops: input.feeStroops,
    validitySeconds: 300,
  });
}

/**
 * Deliberately unavailable until the reviewed operational signer supplies the
 * injected secretless primitive. Fails before preflight or attempt creation.
 */
export async function getServerSharedIssuanceOrchestrator(): Promise<SharedIssuanceOrchestrator> {
  throw new SharedIssuanceRuntimeUnavailableError(
    "The reviewed Shared Issuer signing primitive is not installed.",
  );
}
