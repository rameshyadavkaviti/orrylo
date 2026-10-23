import { createHash, timingSafeEqual } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";

type ErrorCode = "missing_configuration" | "signer_key_mismatch";

export class PrivateMainnetSignerError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "PrivateMainnetSignerError";
  }
}

export interface PrivateMainnetSignerRuntime {
  issuerPublicKey: string;
  signerPublicKey: string;
  isAuthorized(header: string | null): boolean;
}

export function createPrivateMainnetSignerRuntime(input: {
  issuerPublicKey: string;
  signer: Keypair;
  requestAuthSecret: string;
  signerPublicKey?: string;
}): PrivateMainnetSignerRuntime {
  let issuerPublicKey: string;
  let signerPublicKey: string;
  try {
    issuerPublicKey = Keypair.fromPublicKey(input.issuerPublicKey.trim()).publicKey();
    signerPublicKey = Keypair.fromPublicKey(
      input.signerPublicKey?.trim() || issuerPublicKey,
    ).publicKey();
  } catch {
    throw new PrivateMainnetSignerError("missing_configuration");
  }
  if (input.signer.publicKey() !== signerPublicKey) {
    throw new PrivateMainnetSignerError("signer_key_mismatch");
  }
  if (Buffer.byteLength(input.requestAuthSecret, "utf8") < 32) {
    throw new PrivateMainnetSignerError("missing_configuration");
  }
  const digest = createHash("sha256").update(input.requestAuthSecret).digest();
  return {
    issuerPublicKey,
    signerPublicKey,
    isAuthorized(header) {
      if (!header?.startsWith("Bearer ")) return false;
      const candidate = createHash("sha256")
        .update(header.slice("Bearer ".length))
        .digest();
      return timingSafeEqual(digest, candidate);
    },
  };
}

export function readPrivateMainnetSignerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): PrivateMainnetSignerRuntime {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new PrivateMainnetSignerError("missing_configuration");
    return value;
  };
  let signer: Keypair;
  try {
    signer = Keypair.fromSecret(required("ORRYLO_MAINNET_SHARED_ISSUER_SIGNER_SEED"));
  } catch {
    throw new PrivateMainnetSignerError("missing_configuration");
  }
  return createPrivateMainnetSignerRuntime({
    issuerPublicKey: required("ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY"),
    signerPublicKey: env.ORRYLO_MAINNET_SHARED_ISSUER_SIGNER_PUBLIC_KEY,
    requestAuthSecret: required("ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET"),
    signer,
  });
}

/** Readiness-only: no envelope is ever signed, even by an authenticated caller. */
export async function handlePrivateMainnetSignerRequest(
  request: {
    method: string;
    path: string;
    authorization: string | null;
    readBody(): Promise<string>;
  },
  runtime: PrivateMainnetSignerRuntime,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (request.method === "GET" && request.path === "/healthz") {
    return {
      status: 200,
      body: {
        ok: true,
        ready: true,
        service: "orrylo-private-mainnet-signer",
        network: "public",
        issuerPublicKey: runtime.issuerPublicKey,
        signerPublicKey: runtime.signerPublicKey,
        signingEnabled: false,
      },
    };
  }
  if (request.method !== "POST" || request.path !== "/v1/sign") {
    return { status: 404, body: { ok: false, code: "not_found" } };
  }
  if (!runtime.isAuthorized(request.authorization)) {
    return { status: 401, body: { ok: false, code: "unauthorized" } };
  }
  return { status: 503, body: { ok: false, code: "signing_disabled" } };
}
