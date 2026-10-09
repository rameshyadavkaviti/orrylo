import { SHARED_ASSET_DOMAIN } from "../product/constants";

export const SHARED_METADATA_TOML_PATH = "/.well-known/stellar.toml";
export const SHARED_METADATA_TOML_ENDPOINT = `https://${SHARED_ASSET_DOMAIN}${SHARED_METADATA_TOML_PATH}`;

export interface MetadataPublicationState {
  projectId: string;
  metadataHome: string;
  network: "testnet" | "public";
  assetCode: string;
  issuerPublicKey: string;
  currencyToml: string;
  contentHash: string;
  revision: number;
  publishedAt: string;
  updatedAt: string;
  reachable: boolean;
  verifiedAt: string | null;
  lastVerificationAt: string | null;
  verificationErrorCode: string | null;
}

export function renderSharedTestnetToml(
  publications: MetadataPublicationState[],
): string {
  return publications
    .filter(
      (publication) =>
        publication.network === "testnet" &&
        publication.metadataHome === SHARED_ASSET_DOMAIN,
    )
    .toSorted((left, right) => {
      const code = left.assetCode.localeCompare(right.assetCode);

      if (code !== 0) {
        return code;
      }

      const issuer = left.issuerPublicKey.localeCompare(right.issuerPublicKey);

      if (issuer !== 0) {
        return issuer;
      }

      return left.projectId.localeCompare(right.projectId);
    })
    .map((publication) => publication.currencyToml)
    .join("\n");
}
