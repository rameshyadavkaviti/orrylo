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
import { PrivateRailwaySharedIssuerSigningPrimitive } from "../../stellar/private-railway-signer";
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
  signerPublicKey?: string;
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
      input.signerPublicKey,
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

export interface SharedIssuanceRuntimeConfig {
  issuerPublicKey: string;
  signerPublicKey?: string;
  feeStroops: string;
  signerPrivateUrl: string;
  signerRequestAuthSecret: string;
  confirmationWriterDatabaseUrl: string;
}

let serverOrchestrator: Promise<SharedIssuanceOrchestrator> | null = null;

export function readSharedIssuanceRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): SharedIssuanceRuntimeConfig {
  if (env.NEXT_PUBLIC_STELLAR_NETWORK?.trim() !== "testnet") {
    throw unavailable("NEXT_PUBLIC_STELLAR_NETWORK must be testnet.");
  }

  const config = {
    signerPublicKey: env.ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_PUBLIC_KEY,
    issuerPublicKey: required(
      env,
      "ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY",
    ),
    feeStroops: required(env, "ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS"),
    signerPrivateUrl: required(env, "ORRYLO_TESTNET_SIGNER_PRIVATE_URL"),
    signerRequestAuthSecret: required(
      env,
      "ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET",
    ),
    confirmationWriterDatabaseUrl: required(
      env,
      "ORRYLO_CONFIRMATION_WRITER_DATABASE_URL",
    ),
  };

  if (!/^[1-9][0-9]*$/.test(config.feeStroops)) {
    throw unavailable("Configured Shared Issuer fee is invalid.");
  }

  createSharedIssuanceRuntimeSigningPrimitive(config);
  return config;
}

export function createSharedIssuanceRuntimeSigningPrimitive(
  config: SharedIssuanceRuntimeConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): SharedIssuerSigningPrimitive {
  try {
    return new PrivateRailwaySharedIssuerSigningPrimitive(
      {
        privateBaseUrl: config.signerPrivateUrl,
        requestAuthSecret: config.signerRequestAuthSecret,
        issuerPublicKey: config.issuerPublicKey,
        signerPublicKey: config.signerPublicKey,
      },
      fetchImpl,
    );
  } catch {
    throw unavailable("Private Testnet signer configuration is invalid.");
  }
}

/**
 * Production composition for the owner-approved bounded private Railway Testnet
 * signer. Missing or invalid activation inputs fail before preflight or attempt
 * creation. The web process receives no Stellar signing seed.
 */
export async function getServerSharedIssuanceOrchestrator(): Promise<SharedIssuanceOrchestrator> {
  if (!serverOrchestrator) {
    const config = readSharedIssuanceRuntimeConfig();
    const primitive = createSharedIssuanceRuntimeSigningPrimitive(config);
    serverOrchestrator = createServerSharedIssuanceOrchestrator({
      primitive,
      issuerPublicKey: config.issuerPublicKey,
      signerPublicKey: config.signerPublicKey,
      feeStroops: config.feeStroops,
      confirmationWriterDatabaseUrl: config.confirmationWriterDatabaseUrl,
    });
  }

  return serverOrchestrator;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw unavailable(`${name} is required.`);
  return value;
}

function unavailable(message: string): SharedIssuanceRuntimeUnavailableError {
  return new SharedIssuanceRuntimeUnavailableError(message);
}
