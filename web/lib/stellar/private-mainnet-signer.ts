import type { MainnetSignerClient } from "../server/projects/mainnet-creation-service";
import { MAINNET_SHARED_ISSUER_PUBLIC_KEY } from "./mainnet-creation";

const HASH = /^[0-9a-f]{64}$/;

function fail(code: string): never {
  throw new Error(code);
}

function endpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("invalid_configuration");
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
    fail("invalid_configuration");
  }
  return new URL("/v1/sign-and-submit", url);
}

export class PrivateMainnetSignerClient implements MainnetSignerClient {
  private readonly url: URL;
  private readonly healthUrl: URL;
  private readonly auth: string;

  constructor(
    input: { privateBaseUrl: string; requestAuthSecret: string },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.url = endpoint(input.privateBaseUrl);
    this.healthUrl = new URL("/healthz", this.url);
    if (Buffer.byteLength(input.requestAuthSecret, "utf8") < 32) {
      fail("invalid_configuration");
    }
    this.auth = input.requestAuthSecret;
  }

  async checkReady(): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.healthUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.auth}`,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      fail("signer_unavailable");
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      fail("signer_unavailable");
    }
    if (!response.ok || !result || typeof result !== "object" || Array.isArray(result)) {
      fail("signer_unavailable");
    }
    const value = result as Record<string, unknown>;
    if (
      value.ok !== true ||
      value.ready !== true ||
      value.service !== "orrylo-mainnet-signer" ||
      value.network !== "public" ||
      value.issuerPublicKey !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
      value.signerPublicKey !== MAINNET_SHARED_ISSUER_PUBLIC_KEY ||
      value.signingEnabled !== true ||
      Object.keys(value).sort().join(",") !==
        "issuerPublicKey,network,ok,ready,service,signerPublicKey,signingEnabled"
    ) {
      fail("signer_identity_mismatch");
    }
  }

  async signAndSubmit(
    input: Parameters<MainnetSignerClient["signAndSubmit"]>[0],
  ): ReturnType<MainnetSignerClient["signAndSubmit"]> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.auth}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      fail("signer_transport_uncertain");
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      fail("signer_transport_uncertain");
    }
    if (!response.ok) fail("signer_transport_uncertain");
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      fail("signer_response_mismatch");
    }
    const value = result as Record<string, unknown>;
    if (
      value.ok !== true ||
      value.transactionHash !== input.transactionHash ||
      typeof value.signedEnvelopeXdrSha256 !== "string" ||
      !HASH.test(value.signedEnvelopeXdrSha256) ||
      Object.keys(value).sort().join(",") !==
        "ok,signedEnvelopeXdrSha256,transactionHash"
    ) {
      fail("signer_response_mismatch");
    }
    return {
      transactionHash: input.transactionHash,
      signedEnvelopeXdrSha256: value.signedEnvelopeXdrSha256,
    };
  }
}
