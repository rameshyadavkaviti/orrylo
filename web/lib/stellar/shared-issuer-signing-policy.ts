import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  SHARED_ISSUANCE_POLICY_VERSION,
  SHARED_ISSUER_TESTNET_NETWORK,
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  assertSignedEnvelopeAuthorizedForSubmission,
  assertSigningRequestMatchesPlan,
  hashSharedIssuerIssuanceIntent,
  type SharedIssuerIssuancePlan,
  type SharedIssuerSigner,
  type SharedIssuerSigningRequest,
} from "./shared-issuer-issuance";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
const CANONICAL_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)\.[0-9]{7}$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^[0-9]+$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

export type SharedIssuerSigningPolicyErrorCode =
  | "invalid_signing_policy"
  | "invalid_signing_request"
  | "signing_policy_unavailable"
  | "canonical_plan_not_found"
  | "canonical_plan_mismatch"
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

/**
 * Trusted policy lookup for the isolated signer boundary.
 *
 * Production wiring must resolve only the currently active immutable attempt
 * for the exact transaction hash. MVP Lite permits attempt 1 only, so this
 * lookup must fail closed for cancelled, terminal, conflicting, or otherwise
 * non-signable records.
 */
export interface SharedIssuerCanonicalSigningPlanResolver {
  resolveActiveCanonicalPlan(
    transactionHash: string,
  ): Promise<SharedIssuerIssuancePlan | null>;
}

/**
 * Secret-custody boundary supplied by a separately authorized isolated signer.
 *
 * This repository slice deliberately does not define how a seed is generated,
 * imported, stored, unlocked, or deployed. The primitive receives only the
 * already policy-approved canonical Testnet envelope and its exact hash.
 */
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
 * Secretless policy shell for the owner-approved MVP Lite one-signer model.
 *
 * The application can request signing only by exact transaction hash/XDR. The
 * signer independently resolves the durable canonical plan, reconstructs the
 * one-payment Testnet transaction from immutable intent, and validates the
 * returned signature before releasing signed XDR to the caller.
 */
export class PolicyBoundSharedIssuerTestnetSigner implements SharedIssuerSigner {
  private readonly issuerPublicKey: string;

  constructor(
    policy: SharedIssuerMvpLiteSigningPolicy,
    private readonly resolver: SharedIssuerCanonicalSigningPlanResolver,
    private readonly primitive: SharedIssuerSigningPrimitive,
  ) {
    try {
      this.issuerPublicKey = normalizePublicKey(policy.issuerPublicKey);
    } catch {
      throw new SharedIssuerSigningPolicyError(
        "invalid_signing_policy",
        "Local signing policy requires one checksum-valid Shared Issuer public key.",
      );
    }
  }

  async signCanonicalEnvelope(
    request: SharedIssuerSigningRequest,
  ): Promise<{ signedEnvelopeXdr: string }> {
    assertRequestBoundary(request, this.issuerPublicKey);

    let plan: SharedIssuerIssuancePlan | null;
    try {
      plan = await this.resolver.resolveActiveCanonicalPlan(
        request.transactionHash,
      );
    } catch {
      throw new SharedIssuerSigningPolicyError(
        "signing_policy_unavailable",
        "The trusted canonical signing-policy resolver is unavailable.",
      );
    }
    if (!plan) {
      throw new SharedIssuerSigningPolicyError(
        "canonical_plan_not_found",
        "No active immutable issuance plan authorizes this transaction hash.",
      );
    }

    assertCanonicalPlan(plan, this.issuerPublicKey);

    try {
      assertSigningRequestMatchesPlan(request, plan);
    } catch {
      throw new SharedIssuerSigningPolicyError(
        "invalid_signing_request",
        "Signing request does not exactly match the active immutable issuance plan.",
      );
    }

    let signed: { signedEnvelopeXdr: string };
    try {
      signed = await this.primitive.signCanonicalEnvelope({
        transactionHash: plan.transactionHash,
        unsignedEnvelopeXdr: plan.unsignedEnvelopeXdr,
      });
    } catch {
      throw new SharedIssuerSigningPolicyError(
        "signing_primitive_unavailable",
        "The isolated signing primitive could not complete the authorized request.",
      );
    }

    if (
      !signed ||
      typeof signed.signedEnvelopeXdr !== "string" ||
      !signed.signedEnvelopeXdr
    ) {
      throw new SharedIssuerSigningPolicyError(
        "signing_primitive_mismatch",
        "Isolated signing primitive did not return a signed envelope.",
      );
    }

    try {
      assertSignedEnvelopeAuthorizedForSubmission(
        signed.signedEnvelopeXdr,
        plan,
        {
          network: SHARED_ISSUER_TESTNET_NETWORK,
          networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
          issuerPublicKey: this.issuerPublicKey,
          requiredWeight: 1,
          signers: [{ publicKey: this.issuerPublicKey, weight: 1 }],
        },
      );
    } catch {
      throw new SharedIssuerSigningPolicyError(
        "signing_primitive_mismatch",
        "Signed envelope is not authorized by the exact owner-approved MVP Lite issuer signer.",
      );
    }

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
    throw new SharedIssuerSigningPolicyError(
      "invalid_signing_request",
      "Signing request contains an invalid issuer identity.",
    );
  }

  if (
    request.policyVersion !== SHARED_ISSUANCE_POLICY_VERSION ||
    request.network !== SHARED_ISSUER_TESTNET_NETWORK ||
    request.networkPassphrase !== SHARED_ISSUER_TESTNET_PASSPHRASE ||
    requestIssuer !== issuerPublicKey ||
    typeof request.transactionHash !== "string" ||
    !HASH_PATTERN.test(request.transactionHash) ||
    typeof request.unsignedEnvelopeXdr !== "string" ||
    !request.unsignedEnvelopeXdr
  ) {
    throw new SharedIssuerSigningPolicyError(
      "invalid_signing_request",
      "Signing request is outside the fixed Testnet Shared Issuer MVP Lite policy.",
    );
  }
}

function assertCanonicalPlan(
  plan: SharedIssuerIssuancePlan,
  issuerPublicKey: string,
): void {
  try {
    const destinationPublicKey = normalizePublicKey(
      plan.intent.destinationPublicKey,
    );
    const canonicalAmountMatch = CANONICAL_AMOUNT_PATTERN.exec(
      plan.intent.amount,
    );
    const amountUnits = canonicalAmountMatch
      ? BigInt(canonicalAmountMatch[0].replace(".", ""))
      : 0n;

    if (
      plan.intent.policyVersion !== SHARED_ISSUANCE_POLICY_VERSION ||
      plan.intent.network !== SHARED_ISSUER_TESTNET_NETWORK ||
      typeof plan.intent.projectId !== "string" ||
      !plan.intent.projectId ||
      plan.intent.projectId.trim() !== plan.intent.projectId ||
      normalizePublicKey(plan.intent.issuerPublicKey) !== issuerPublicKey ||
      destinationPublicKey === issuerPublicKey ||
      !ASSET_CODE_PATTERN.test(plan.intent.assetCode) ||
      !canonicalAmountMatch ||
      amountUnits <= 0n ||
      !HASH_PATTERN.test(plan.transactionHash) ||
      !NON_NEGATIVE_INTEGER_PATTERN.test(plan.sourceSequence) ||
      !POSITIVE_INTEGER_PATTERN.test(plan.feeStroops) ||
      !Number.isSafeInteger(plan.validFrom) ||
      !Number.isSafeInteger(plan.validUntil) ||
      plan.validFrom < 0 ||
      plan.validUntil <= plan.validFrom ||
      plan.intentFingerprint !== hashSharedIssuerIssuanceIntent(plan.intent)
    ) {
      throw new Error("invalid plan metadata");
    }

    const rebuilt = new TransactionBuilder(
      new Account(issuerPublicKey, BigInt(plan.sourceSequence).toString()),
      {
        fee: BigInt(plan.feeStroops).toString(),
        networkPassphrase: Networks.TESTNET,
      },
    )
      .addOperation(
        Operation.payment({
          destination: destinationPublicKey,
          asset: new Asset(plan.intent.assetCode, issuerPublicKey),
          amount: plan.intent.amount,
        }),
      )
      .setTimebounds(plan.validFrom, plan.validUntil)
      .build();

    const rebuiltXdr = rebuilt.toXDR();
    const rebuiltHash = Buffer.from(rebuilt.hash()).toString("hex");

    if (
      rebuiltXdr !== plan.unsignedEnvelopeXdr ||
      rebuiltHash !== plan.transactionHash
    ) {
      throw new Error("canonical transaction mismatch");
    }
  } catch {
    throw new SharedIssuerSigningPolicyError(
      "canonical_plan_mismatch",
      "Durable issuance plan is not the exact canonical one-payment Testnet transaction authorized by immutable intent.",
    );
  }
}

function normalizePublicKey(value: string): string {
  return Keypair.fromPublicKey(value.trim().toUpperCase()).publicKey();
}
