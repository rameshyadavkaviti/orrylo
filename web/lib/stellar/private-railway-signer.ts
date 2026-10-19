import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";

import { isForbiddenTestnetSharedIssuerPublicKey } from "../product/constants";
import { SHARED_ISSUER_TESTNET_PASSPHRASE } from "./shared-issuer-issuance";
import type { SharedIssuerSigningPrimitive } from "./shared-issuer-signing-policy";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MIN_AUTH_SECRET_BYTES = 32;

export type PrivateRailwaySignerPrimitiveErrorCode =
  | "invalid_configuration"
  | "signer_unavailable"
  | "signer_response_mismatch"
  | "signer_identity_mismatch"
  | "signer_authentication_failed"
  | "signer_request_rejected";

export type PrivateRailwaySignerIdentityMismatchField =
  | "readiness"
  | "service"
  | "network"
  | "issuer_public_key"
  | "signer_public_key";

export class PrivateRailwaySignerPrimitiveError extends Error {
  constructor(
    readonly code: PrivateRailwaySignerPrimitiveErrorCode,
    readonly mismatchField?: PrivateRailwaySignerIdentityMismatchField,
  ) {
    super(code);
    this.name = "PrivateRailwaySignerPrimitiveError";
  }
}

export class PrivateRailwaySharedIssuerSigningPrimitive implements SharedIssuerSigningPrimitive {
  private readonly endpoint: URL;
  private readonly issuerPublicKey: string;
  private readonly signerPublicKey: string;
  private readonly requestAuthSecret: string;

  constructor(
    input: {
      privateBaseUrl: string;
      requestAuthSecret: string;
      issuerPublicKey: string;
      signerPublicKey?: string;
    },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.endpoint = normalizePrivateRailwayEndpoint(input.privateBaseUrl);
    this.issuerPublicKey = normalizeAllowedIssuer(input.issuerPublicKey);
    this.signerPublicKey = normalizeAllowedIssuer(
      input.signerPublicKey ?? input.issuerPublicKey,
    );

    if (
      Buffer.byteLength(input.requestAuthSecret, "utf8") < MIN_AUTH_SECRET_BYTES
    ) {
      throw new PrivateRailwaySignerPrimitiveError("invalid_configuration");
    }
    this.requestAuthSecret = input.requestAuthSecret;
  }

  /** No envelope is constructed or sent. Run before consuming attempt 1. */
  async assertReady(): Promise<void> {
    try {
      const response = await this.fetchImpl(
        new URL("/healthz", this.endpoint),
        {
          method: "GET",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok)
        throw new PrivateRailwaySignerPrimitiveError("signer_unavailable");
      const health = await response.json();
      const mismatchField = signerIdentityMismatchField(
        health,
        this.issuerPublicKey,
        this.signerPublicKey,
      );
      if (mismatchField) {
        throw new PrivateRailwaySignerPrimitiveError(
          "signer_identity_mismatch",
          mismatchField,
        );
      }
      // The reviewed service authenticates, then rejects this missing-field body
      // before XDR parsing or signing. Never send an envelope as a health probe.
      const probe = await this.fetchImpl(new URL("/v1/sign", this.endpoint), {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: {
          authorization: `Bearer ${this.requestAuthSecret}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (probe.status === 401)
        throw new PrivateRailwaySignerPrimitiveError(
          "signer_authentication_failed",
        );
      if (probe.status !== 400)
        throw new PrivateRailwaySignerPrimitiveError("signer_unavailable");
      const rejection = await probe.json();
      if (rejection?.ok !== false || rejection?.code !== "invalid_request") {
        throw new PrivateRailwaySignerPrimitiveError("signer_unavailable");
      }
    } catch (error) {
      if (error instanceof PrivateRailwaySignerPrimitiveError) throw error;
      throw new PrivateRailwaySignerPrimitiveError("signer_unavailable");
    }
  }

  async signCanonicalEnvelope(input: {
    transactionHash: string;
    unsignedEnvelopeXdr: string;
  }): Promise<{ signedEnvelopeXdr: string }> {
    if (
      !HASH_PATTERN.test(input.transactionHash) ||
      !input.unsignedEnvelopeXdr
    ) {
      throw new PrivateRailwaySignerPrimitiveError("signer_unavailable");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(new URL("/v1/sign", this.endpoint), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.requestAuthSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          transactionHash: input.transactionHash,
          unsignedEnvelopeXdr: input.unsignedEnvelopeXdr,
        }),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new PrivateRailwaySignerPrimitiveError("signer_unavailable");
    }

    if (!response.ok) {
      if (response.status === 401)
        throw new PrivateRailwaySignerPrimitiveError(
          "signer_authentication_failed",
        );
      if (response.status === 400)
        throw new PrivateRailwaySignerPrimitiveError("signer_request_rejected");
      throw new PrivateRailwaySignerPrimitiveError("signer_unavailable");
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new PrivateRailwaySignerPrimitiveError("signer_response_mismatch");
    }

    return {
      signedEnvelopeXdr: assertSignerResponse(
        value,
        input.transactionHash,
        this.issuerPublicKey,
        this.signerPublicKey,
      ),
    };
  }
}

function signerIdentityMismatchField(
  health: unknown,
  issuerPublicKey: string,
  signerPublicKey: string,
): PrivateRailwaySignerIdentityMismatchField | null {
  if (!health || typeof health !== "object" || Array.isArray(health)) {
    return "readiness";
  }
  const fields = health as Record<string, unknown>;
  if (fields.ok !== true || fields.ready !== true) return "readiness";
  if (fields.service !== "orrylo-private-testnet-signer") return "service";
  if (fields.network !== "testnet") return "network";
  if (fields.issuerPublicKey !== issuerPublicKey) return "issuer_public_key";
  if (fields.signerPublicKey !== signerPublicKey) return "signer_public_key";
  return null;
}

function assertSignerResponse(
  value: unknown,
  transactionHash: string,
  issuerPublicKey: string,
  signerPublicKey: string,
): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrivateRailwaySignerPrimitiveError("signer_response_mismatch");
  }

  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !==
      "network,ok,signedEnvelopeXdr,signerPublicKey" ||
    fields.ok !== true ||
    fields.network !== "testnet" ||
    fields.signerPublicKey !== signerPublicKey ||
    typeof fields.signedEnvelopeXdr !== "string"
  ) {
    throw new PrivateRailwaySignerPrimitiveError("signer_response_mismatch");
  }

  let transaction: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(
      fields.signedEnvelopeXdr,
      SHARED_ISSUER_TESTNET_PASSPHRASE,
    );
    if (!(parsed instanceof Transaction)) throw new Error("fee bump rejected");
    transaction = parsed;
  } catch {
    throw new PrivateRailwaySignerPrimitiveError("signer_response_mismatch");
  }

  const issuer = Keypair.fromPublicKey(signerPublicKey);
  const signature = transaction.signatures[0];

  if (
    transaction.source !== issuerPublicKey ||
    Buffer.from(transaction.hash()).toString("hex") !== transactionHash ||
    transaction.signatures.length !== 1 ||
    !signature ||
    !Buffer.from(signature.hint.toBytes()).equals(
      Buffer.from(issuer.signatureHint()),
    ) ||
    !issuer.verify(transaction.hash(), signature.signature)
  ) {
    throw new PrivateRailwaySignerPrimitiveError("signer_response_mismatch");
  }

  return fields.signedEnvelopeXdr;
}

function normalizePrivateRailwayEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PrivateRailwaySignerPrimitiveError("invalid_configuration");
  }

  if (
    url.protocol !== "http:" ||
    !url.hostname.endsWith(".railway.internal") ||
    url.hostname === "railway.internal" ||
    !url.port ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new PrivateRailwaySignerPrimitiveError("invalid_configuration");
  }

  return url;
}

function normalizeAllowedIssuer(value: string): string {
  let normalized: string;
  try {
    normalized = Keypair.fromPublicKey(value.trim().toUpperCase()).publicKey();
  } catch {
    throw new PrivateRailwaySignerPrimitiveError("invalid_configuration");
  }

  if (isForbiddenTestnetSharedIssuerPublicKey(normalized)) {
    throw new PrivateRailwaySignerPrimitiveError("invalid_configuration");
  }

  return normalized;
}
