import {
  Keypair,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  signPersistedSharedIssuerEnvelope,
  type SharedIssuerDurableExecutionReader,
} from "./shared-issuer-execution";
import {
  SHARED_ISSUANCE_POLICY_VERSION,
  SHARED_ISSUER_TESTNET_NETWORK,
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  type SharedIssuerIssuancePlan,
  type SharedIssuerSigner,
  type SharedIssuerSignerAuthorization,
  type SharedIssuerSigningRequest,
} from "./shared-issuer-issuance";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export type SharedIssuerSigningPolicyErrorCode =
  | "invalid_signing_policy"
  | "invalid_signing_request"
  | "signing_primitive_unavailable"
  | "signing_primitive_mismatch";

export class SharedIssuerSigningPolicyError extends Error {
  constructor(
    readonly code: SharedIssuerSigningPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SharedIssuerSigningPolicyError";
  }
}

export interface SharedIssuerSigningPrimitive {
  signCanonicalEnvelope(input: {
    transactionHash: string;
    unsignedEnvelopeXdr: string;
  }): Promise<{ signedEnvelopeXdr: string }>;
}

export interface SharedIssuerMvpLiteSigningPolicy {
  issuerPublicKey: string;
}

/**
 * Single supported signing entry for the Testnet MVP Lite stack.
 *
 * PR #32 owns canonical reconstruction and the durable intent/attempt binding.
 * This boundary reuses that proof before the isolated primitive is invoked,
 * instead of maintaining PR #50's second resolver/reconstruction system.
 */
export async function signDurableSharedIssuerTestnetEnvelope(input: {
  reader: SharedIssuerDurableExecutionReader;
  attemptId: string;
  plan: SharedIssuerIssuancePlan;
  policy: SharedIssuerMvpLiteSigningPolicy;
  primitive: SharedIssuerSigningPrimitive;
}): Promise<{ signedEnvelopeXdr: string }> {
  const signer = new PrimitiveBackedSharedIssuerTestnetSigner(
    input.policy,
    input.primitive,
  );
  return signPersistedSharedIssuerEnvelope({
    reader: input.reader,
    attemptId: input.attemptId,
    plan: input.plan,
    signer,
  });
}

export function createSharedIssuerMvpLiteSignerAuthorization(
  issuerPublicKey: string,
): SharedIssuerSignerAuthorization {
  const normalizedIssuer = normalizePublicKey(issuerPublicKey);
  return {
    network: SHARED_ISSUER_TESTNET_NETWORK,
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
    issuerPublicKey: normalizedIssuer,
    requiredWeight: 1,
    signers: [{ publicKey: normalizedIssuer, weight: 1 }],
  };
}

class PrimitiveBackedSharedIssuerTestnetSigner implements SharedIssuerSigner {
  private readonly issuerPublicKey: string;

  constructor(
    policy: SharedIssuerMvpLiteSigningPolicy,
    private readonly primitive: SharedIssuerSigningPrimitive,
  ) {
    this.issuerPublicKey = normalizePublicKey(policy.issuerPublicKey);
  }

  async signCanonicalEnvelope(
    request: SharedIssuerSigningRequest,
  ): Promise<{ signedEnvelopeXdr: string }> {
    assertRequestBoundary(request, this.issuerPublicKey);

    let signed: { signedEnvelopeXdr: string };
    try {
      signed = await this.primitive.signCanonicalEnvelope({
        transactionHash: request.transactionHash,
        unsignedEnvelopeXdr: request.unsignedEnvelopeXdr,
      });
    } catch {
      throw new SharedIssuerSigningPolicyError(
        "signing_primitive_unavailable",
        "The isolated Testnet signing primitive could not complete the authorized request.",
      );
    }

    if (
      !signed ||
      typeof signed.signedEnvelopeXdr !== "string" ||
      !signed.signedEnvelopeXdr
    ) {
      throw primitiveMismatch();
    }

    assertPrimitiveOutput(
      signed.signedEnvelopeXdr,
      request.transactionHash,
      this.issuerPublicKey,
    );
    return signed;
  }
}

function assertRequestBoundary(
  request: SharedIssuerSigningRequest,
  issuerPublicKey: string,
): void {
  let requestIssuer: string;
  try {
    requestIssuer = normalizePublicKey(request.issuerPublicKey);
  } catch {
    throw invalidSigningRequest();
  }

  if (
    request.policyVersion !== SHARED_ISSUANCE_POLICY_VERSION ||
    request.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    request.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE ||
    requestIssuer !== issuerPublicKey ||
    !HASH_PATTERN.test(request.transactionHash) ||
    !request.unsignedEnvelopeXdr
  ) {
    throw invalidSigningRequest();
  }

  let transaction: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(
      request.unsignedEnvelopeXdr,
      SHARED_ISSUER_TESTNET_PASSPHRASE,
    );
    if (!(parsed instanceof Transaction)) throw new Error("fee bump rejected");
    transaction = parsed;
  } catch {
    throw invalidSigningRequest();
  }

  if (
    transaction.signatures.length !== 0 ||
    Buffer.from(transaction.hash()).toString("hex") !== request.transactionHash
  ) {
    throw invalidSigningRequest();
  }
}

function assertPrimitiveOutput(
  signedEnvelopeXdr: string,
  expectedTransactionHash: string,
  issuerPublicKey: string,
): void {
  let transaction: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(
      signedEnvelopeXdr,
      SHARED_ISSUER_TESTNET_PASSPHRASE,
    );
    if (!(parsed instanceof Transaction)) throw new Error("fee bump rejected");
    transaction = parsed;
  } catch {
    throw primitiveMismatch();
  }

  if (
    Buffer.from(transaction.hash()).toString("hex") !==
      expectedTransactionHash ||
    transaction.signatures.length !== 1
  ) {
    throw primitiveMismatch();
  }

  const issuer = Keypair.fromPublicKey(issuerPublicKey);
  const signature = transaction.signatures[0];
  if (
    !Buffer.from(signature.hint.toBytes()).equals(
      Buffer.from(issuer.signatureHint()),
    ) ||
    !issuer.verify(transaction.hash(), signature.signature)
  ) {
    throw primitiveMismatch();
  }
}

function normalizePublicKey(value: string): string {
  try {
    return Keypair.fromPublicKey(value.trim().toUpperCase()).publicKey();
  } catch {
    throw new SharedIssuerSigningPolicyError(
      "invalid_signing_policy",
      "Expected a checksum-valid Shared Issuer public key.",
    );
  }
}

function invalidSigningRequest(): SharedIssuerSigningPolicyError {
  return new SharedIssuerSigningPolicyError(
    "invalid_signing_request",
    "Signing request is outside the fixed Testnet Shared Issuer MVP Lite policy.",
  );
}

function primitiveMismatch(): SharedIssuerSigningPolicyError {
  return new SharedIssuerSigningPolicyError(
    "signing_primitive_mismatch",
    "Signed envelope is not the exact one-signer Testnet transaction authorized by the protected boundary.",
  );
}
