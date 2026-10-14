import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";

import { isForbiddenTestnetSharedIssuerPublicKey } from "../product/constants";
import { SHARED_ISSUER_TESTNET_PASSPHRASE } from "./shared-issuer-issuance";
import type { SharedIssuerSigningPrimitive } from "./shared-issuer-signing-policy";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MIN_AUTH_SECRET_BYTES = 32;

export type PrivateRailwaySignerPrimitiveErrorCode =
  "invalid_configuration" | "signer_unavailable" | "signer_response_mismatch";

export class PrivateRailwaySignerPrimitiveError extends Error {
  constructor(readonly code: PrivateRailwaySignerPrimitiveErrorCode) {
    super(code);
    this.name = "PrivateRailwaySignerPrimitiveError";
  }
}

export class PrivateRailwaySharedIssuerSigningPrimitive implements SharedIssuerSigningPrimitive {
  private readonly endpoint: URL;
  private readonly issuerPublicKey: string;
  private readonly requestAuthSecret: string;

  constructor(
    input: {
      privateBaseUrl: string;
      requestAuthSecret: string;
      issuerPublicKey: string;
    },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.endpoint = normalizePrivateRailwayEndpoint(input.privateBaseUrl);
    this.issuerPublicKey = normalizeAllowedIssuer(input.issuerPublicKey);

    if (
      Buffer.byteLength(input.requestAuthSecret, "utf8") < MIN_AUTH_SECRET_BYTES
    ) {
      throw new PrivateRailwaySignerPrimitiveError("invalid_configuration");
    }
    this.requestAuthSecret = input.requestAuthSecret;
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
      ),
    };
  }
}

function assertSignerResponse(
  value: unknown,
  transactionHash: string,
  issuerPublicKey: string,
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
    fields.signerPublicKey !== issuerPublicKey ||
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

  const issuer = Keypair.fromPublicKey(issuerPublicKey);
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
