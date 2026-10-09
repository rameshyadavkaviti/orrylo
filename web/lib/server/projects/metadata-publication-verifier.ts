import {
  SHARED_METADATA_TOML_ENDPOINT,
  type MetadataPublicationState,
} from "../../projects/metadata-publication";

export type MetadataVerificationFailureCode =
  | "request_failed"
  | "unexpected_status"
  | "unexpected_content_type"
  | "content_mismatch"
  | "asset_code_missing"
  | "issuer_missing";

export type MetadataVerificationResult =
  | { ok: true }
  | { ok: false; code: MetadataVerificationFailureCode };

export interface MetadataPublicationVerifier {
  verify(
    publication: Pick<
      MetadataPublicationState,
      "assetCode" | "issuerPublicKey" | "currencyToml" | "contentHash"
    >,
  ): Promise<MetadataVerificationResult>;
}

export class FixedSharedMetadataVerifier
  implements MetadataPublicationVerifier
{
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  async verify(
    publication: Pick<
      MetadataPublicationState,
      "assetCode" | "issuerPublicKey" | "currencyToml" | "contentHash"
    >,
  ): Promise<MetadataVerificationResult> {
    const url = new URL(SHARED_METADATA_TOML_ENDPOINT);
    url.searchParams.set("v", publication.contentHash);

    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "text/plain, application/toml",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { ok: false, code: "request_failed" };
    }

    if (!response.ok) {
      return { ok: false, code: "unexpected_status" };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (
      !contentType.includes("text/plain") &&
      !contentType.includes("application/toml")
    ) {
      return { ok: false, code: "unexpected_content_type" };
    }

    const body = await response.text();

    if (!body.includes(publication.currencyToml)) {
      return { ok: false, code: "content_mismatch" };
    }

    if (!body.includes(`code = "${publication.assetCode}"`)) {
      return { ok: false, code: "asset_code_missing" };
    }

    if (!body.includes(`issuer = "${publication.issuerPublicKey}"`)) {
      return { ok: false, code: "issuer_missing" };
    }

    return { ok: true };
  }
}
