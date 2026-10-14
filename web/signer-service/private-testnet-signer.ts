import { createHash, timingSafeEqual } from "node:crypto";

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { isForbiddenTestnetSharedIssuerPublicKey } from "../lib/product/constants";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MIN_AUTH_SECRET_BYTES = 32;

export type PrivateTestnetSignerErrorCode =
  | "missing_configuration"
  | "forbidden_issuer"
  | "signer_key_mismatch"
  | "unauthorized"
  | "invalid_request"
  | "transaction_mismatch";

export class PrivateTestnetSignerError extends Error {
  constructor(readonly code: PrivateTestnetSignerErrorCode) {
    super(code);
    this.name = "PrivateTestnetSignerError";
  }
}

export interface PrivateTestnetSignerRuntime {
  readonly issuerPublicKey: string;
  isAuthorized(authorizationHeader: string | null): boolean;
  signCanonicalRequest(input: unknown): {
    network: "testnet";
    signerPublicKey: string;
    signedEnvelopeXdr: string;
  };
}

export interface PrivateTestnetSignerHttpInput {
  method: string;
  path: string;
  authorization: string | null;
  readBody(): Promise<string>;
}

export interface PrivateTestnetSignerHttpResult {
  status: number;
  body: Record<string, unknown>;
}

export function createPrivateTestnetSignerRuntime(input: {
  issuerPublicKey: string;
  requestAuthSecret: string;
  signer: Keypair;
  signEnvelope?: (transaction: Transaction, signer: Keypair) => void;
}): PrivateTestnetSignerRuntime {
  const issuerPublicKey = normalizeAllowedIssuer(input.issuerPublicKey);
  const authSecret = normalizeAuthSecret(input.requestAuthSecret);

  if (input.signer.publicKey() !== issuerPublicKey) {
    throw new PrivateTestnetSignerError("signer_key_mismatch");
  }

  const expectedAuthDigest = sha256(authSecret);
  const signEnvelope =
    input.signEnvelope ??
    ((transaction: Transaction, signer: Keypair) => {
      transaction.sign(signer);
    });

  return {
    issuerPublicKey,
    isAuthorized(authorizationHeader) {
      if (!authorizationHeader?.startsWith("Bearer ")) return false;
      const candidate = authorizationHeader.slice("Bearer ".length);
      const candidateDigest = sha256(candidate);
      return timingSafeEqual(expectedAuthDigest, candidateDigest);
    },
    signCanonicalRequest(value) {
      const request = parseSigningRequest(value);
      let transaction: Transaction;

      try {
        const parsed = TransactionBuilder.fromXDR(
          request.unsignedEnvelopeXdr,
          Networks.TESTNET,
        );
        if (!(parsed instanceof Transaction)) {
          throw new Error("fee bump rejected");
        }
        transaction = parsed;
      } catch {
        throw new PrivateTestnetSignerError("invalid_request");
      }

      if (
        transaction.signatures.length !== 0 ||
        transaction.source !== issuerPublicKey
      ) {
        throw new PrivateTestnetSignerError("transaction_mismatch");
      }

      if (
        Buffer.from(transaction.hash()).toString("hex") !==
        request.transactionHash
      ) {
        throw new PrivateTestnetSignerError("transaction_mismatch");
      }

      signEnvelope(transaction, input.signer);

      if (transaction.signatures.length !== 1) {
        throw new PrivateTestnetSignerError("transaction_mismatch");
      }

      return {
        network: "testnet",
        signerPublicKey: issuerPublicKey,
        signedEnvelopeXdr: transaction.toXDR(),
      };
    },
  };
}

export function readPrivateTestnetSignerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): PrivateTestnetSignerRuntime {
  const issuerPublicKey = required(
    env,
    "ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY",
  );
  const requestAuthSecret = required(
    env,
    "ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET",
  );
  const signerSeed = required(
    env,
    "ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_SEED",
  );

  let signer: Keypair;
  try {
    signer = Keypair.fromSecret(signerSeed);
  } catch {
    throw new PrivateTestnetSignerError("missing_configuration");
  }

  return createPrivateTestnetSignerRuntime({
    issuerPublicKey,
    requestAuthSecret,
    signer,
  });
}

export async function handlePrivateTestnetSignerRequest(
  input: PrivateTestnetSignerHttpInput,
  runtime: PrivateTestnetSignerRuntime,
): Promise<PrivateTestnetSignerHttpResult> {
  if (input.method === "GET" && input.path === "/healthz") {
    return {
      status: 200,
      body: {
        ok: true,
        service: "orrylo-private-testnet-signer",
        network: "testnet",
        issuerPublicKey: runtime.issuerPublicKey,
        ready: true,
      },
    };
  }

  if (input.method !== "POST" || input.path !== "/v1/sign") {
    return { status: 404, body: { ok: false, code: "not_found" } };
  }

  if (!runtime.isAuthorized(input.authorization)) {
    return { status: 401, body: { ok: false, code: "unauthorized" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await input.readBody());
  } catch {
    return { status: 400, body: { ok: false, code: "invalid_request" } };
  }

  try {
    return {
      status: 200,
      body: { ok: true, ...runtime.signCanonicalRequest(parsed) },
    };
  } catch (error) {
    return {
      status: 400,
      body: {
        ok: false,
        code:
          error instanceof PrivateTestnetSignerError
            ? error.code
            : "invalid_request",
      },
    };
  }
}

function parseSigningRequest(value: unknown): {
  transactionHash: string;
  unsignedEnvelopeXdr: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrivateTestnetSignerError("invalid_request");
  }

  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !==
      "transactionHash,unsignedEnvelopeXdr" ||
    typeof fields.transactionHash !== "string" ||
    typeof fields.unsignedEnvelopeXdr !== "string" ||
    !HASH_PATTERN.test(fields.transactionHash) ||
    !fields.unsignedEnvelopeXdr
  ) {
    throw new PrivateTestnetSignerError("invalid_request");
  }

  return {
    transactionHash: fields.transactionHash,
    unsignedEnvelopeXdr: fields.unsignedEnvelopeXdr,
  };
}

function normalizeAllowedIssuer(value: string): string {
  let normalized: string;
  try {
    normalized = Keypair.fromPublicKey(value.trim().toUpperCase()).publicKey();
  } catch {
    throw new PrivateTestnetSignerError("missing_configuration");
  }

  if (isForbiddenTestnetSharedIssuerPublicKey(normalized)) {
    throw new PrivateTestnetSignerError("forbidden_issuer");
  }

  return normalized;
}

function normalizeAuthSecret(value: string): string {
  if (Buffer.byteLength(value, "utf8") < MIN_AUTH_SECRET_BYTES) {
    throw new PrivateTestnetSignerError("missing_configuration");
  }
  return value;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new PrivateTestnetSignerError("missing_configuration");
  return value;
}
