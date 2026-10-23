import { createHash, timingSafeEqual } from "node:crypto";

import {
  Asset,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  OFFICIAL_STELLAR_MAINNET_HORIZON_URL,
} from "../lib/stellar/mainnet-creation";
import { validateInitialSupply } from "../lib/validation/initial-supply";

const HASH = /^[0-9a-f]{64}$/;
const CODE = /^[A-Z0-9]{1,12}$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;

export interface MainnetSignerRequest {
  unsignedEnvelopeXdr: string;
  transactionHash: string;
  issuerPublicKey: string;
  destinationPublicKey: string;
  assetCode: string;
  amount: string;
  maxFeeStroops: string;
}

export interface MainnetSignerResult {
  transactionHash: string;
  signedEnvelopeXdrSha256: string;
}

export interface PrivateMainnetSignerRuntime {
  authToken: string;
  issuerPublicKey: string;
  signerPublicKey: string;
  signingEnabled: boolean;
  maxFeeStroops: string;
  signAndSubmit(input: MainnetSignerRequest): Promise<MainnetSignerResult>;
}

function fail(code: string): never {
  throw new Error(code);
}

function normalizedAmountStroops(value: string): bigint {
  const result = validateInitialSupply(value);
  if (!result.valid) fail("invalid_amount");
  return result.stroops;
}

export function validateMainnetSignerEnvelope(
  input: MainnetSignerRequest,
): { transactionHash: string; transaction: Transaction } {
  if (
    input.issuerPublicKey !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    !HASH.test(input.transactionHash) ||
    !CODE.test(input.assetCode) ||
    !INTEGER.test(input.maxFeeStroops) ||
    BigInt(input.maxFeeStroops) <= 0n
  ) {
    fail("invalid_signing_request");
  }
  let transaction: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(
      input.unsignedEnvelopeXdr,
      Networks.PUBLIC,
    );
    if (!(parsed instanceof Transaction)) fail("fee_bump_forbidden");
    transaction = parsed;
  } catch (error) {
    if (error instanceof Error && ["fee_bump_forbidden"].includes(error.message)) throw error;
    fail("invalid_envelope");
  }
  if (transaction.signatures.length !== 0) fail("pre_signed_envelope");
  const hash = Buffer.from(transaction.hash()).toString("hex");
  const operation = transaction.operations[0];
  if (
    hash !== input.transactionHash ||
    transaction.source !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    transaction.operations.length !== 1 ||
    operation?.type !== "payment" ||
    (operation.source && operation.source !== MAINNET_SHARED_ISSUER_PUBLIC_KEY) ||
    operation.destination !== input.destinationPublicKey ||
    !(operation.asset instanceof Asset) ||
    operation.asset.getCode() !== input.assetCode ||
    operation.asset.getIssuer() !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
    normalizedAmountStroops(operation.amount) !== normalizedAmountStroops(input.amount) ||
    BigInt(transaction.fee) > BigInt(input.maxFeeStroops) ||
    !transaction.timeBounds ||
    BigInt(transaction.timeBounds.maxTime) <= BigInt(transaction.timeBounds.minTime)
  ) {
    fail("signing_policy_mismatch");
  }
  return { transactionHash: hash, transaction };
}

function required(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) fail("signer_configuration_unavailable");
  return value;
}

export function createPrivateMainnetSignerRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): PrivateMainnetSignerRuntime {
  const signingEnabled = env.ORRYLO_MAINNET_SIGNER_ENABLED === "true";
  const authToken = required(env, "ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET");
  if (authToken.length < 32) fail("signer_configuration_unavailable");
  const configuredMaxFee = env.ORRYLO_MAINNET_ISSUER_MAX_FEE_STROOPS?.trim();
  if (signingEnabled && !configuredMaxFee) {
    fail("signer_configuration_unavailable");
  }
  const maxFeeStroops = configuredMaxFee || "1000";
  if (!INTEGER.test(maxFeeStroops) || BigInt(maxFeeStroops) <= 0n) {
    fail("signer_configuration_unavailable");
  }
  if (
    required(env, "ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY") !==
    MAINNET_SHARED_ISSUER_PUBLIC_KEY
  ) {
    fail("signer_identity_mismatch");
  }
  const signerPublicKey = env.ORRYLO_MAINNET_SHARED_ISSUER_SIGNER_PUBLIC_KEY?.trim()
    || MAINNET_SHARED_ISSUER_PUBLIC_KEY;
  try {
    Keypair.fromPublicKey(signerPublicKey);
  } catch {
    fail("signer_configuration_unavailable");
  }
  let signer: Keypair | null = null;
  if (signingEnabled) {
    try {
      signer = Keypair.fromSecret(
        required(env, "ORRYLO_MAINNET_SHARED_ISSUER_SIGNER_SEED"),
      );
    } catch {
      fail("signer_configuration_unavailable");
    }
    if (signer.publicKey() !== signerPublicKey) {
      fail("signer_identity_mismatch");
    }
  }
  return {
    authToken,
    issuerPublicKey: MAINNET_SHARED_ISSUER_PUBLIC_KEY,
    signerPublicKey,
    signingEnabled,
    maxFeeStroops,
    async signAndSubmit(input) {
      if (!signingEnabled || !signer) fail("signer_disabled");
      if (input.maxFeeStroops !== maxFeeStroops) {
        fail("signing_policy_mismatch");
      }
      const { transaction, transactionHash } = validateMainnetSignerEnvelope(input);
      transaction.sign(signer);
      const signedEnvelopeXdr = transaction.toXDR();
      const signedEnvelopeXdrSha256 = createHash("sha256")
        .update(signedEnvelopeXdr)
        .digest("hex");
      let response: Response;
      try {
        response = await fetchImpl(
          `${OFFICIAL_STELLAR_MAINNET_HORIZON_URL}/transactions`,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ tx: signedEnvelopeXdr }),
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
          },
        );
      } catch {
        fail("submission_reconciliation_required");
      }
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        fail("submission_reconciliation_required");
      }
      const returnedHash =
        result && typeof result === "object" && "hash" in result
          ? (result as { hash?: unknown }).hash
          : null;
      if (!response.ok || returnedHash !== transactionHash) {
        fail("submission_reconciliation_required");
      }
      return { transactionHash, signedEnvelopeXdrSha256 };
    },
  };
}

function isStrictBody(value: unknown): value is MainnetSignerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const keys = [
    "assetCode",
    "amount",
    "destinationPublicKey",
    "issuerPublicKey",
    "maxFeeStroops",
    "transactionHash",
    "unsignedEnvelopeXdr",
  ];
  return (
    Object.keys(body).sort().join(",") === keys.sort().join(",") &&
    keys.every((key) => typeof body[key] === "string") &&
    (body.unsignedEnvelopeXdr as string).length <= 4096
  );
}

export async function handlePrivateMainnetSignerRequest(
  request: Request,
  runtime: PrivateMainnetSignerRuntime,
): Promise<Response> {
  const authorization = request.headers.get("authorization");
  const authorized = authorization?.startsWith("Bearer ") === true &&
    timingSafeEqual(
      createHash("sha256").update(authorization.slice("Bearer ".length)).digest(),
      createHash("sha256").update(runtime.authToken).digest(),
    );
  if (
    request.method !== "POST" ||
    !authorized
  ) {
    return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }
  if (!runtime.signingEnabled) {
    return Response.json({ ok: false, code: "signing_disabled" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, code: "invalid_request" }, { status: 400 });
  }
  if (!isStrictBody(body)) {
    return Response.json({ ok: false, code: "invalid_request" }, { status: 400 });
  }
  try {
    if (body.maxFeeStroops !== runtime.maxFeeStroops) {
      fail("signing_policy_mismatch");
    }
    validateMainnetSignerEnvelope(body);
    const result = await runtime.signAndSubmit(body);
    if (result.transactionHash !== body.transactionHash || !HASH.test(result.signedEnvelopeXdrSha256)) {
      fail("signer_response_mismatch");
    }
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "signer_failure";
    const safeCode = code === "submission_reconciliation_required"
      ? code
      : "signer_policy_rejected";
    return Response.json({ ok: false, code: safeCode }, { status: 409 });
  }
}
