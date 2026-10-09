import { SHARED_ASSET_DOMAIN } from "../product/constants";

export const SHARED_METADATA_TOML_PATH = "/.well-known/stellar.toml";
export const SHARED_METADATA_TOML_ENDPOINT =
  `https://${SHARED_ASSET_DOMAIN}${SHARED_METADATA_TOML_PATH}`;

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
