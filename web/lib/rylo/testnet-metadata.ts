import {
  RYLO_ABANDONED_TESTNET_ISSUER,
  RYLO_ISSUER_CANDIDATE,
  RYLO_TESTNET_ISSUER,
} from "../product/constants";

export const RYLO_HOME_DOMAIN = "orrylo.com";
export const RYLO_MAINNET_NETWORK_PASSPHRASE =
  "Public Global Stellar Network ; September 2015";
export const ORRYLO_METADATA_LOGO_URL =
  "https://orrylo.com/brand/orrylo-logo.webp";
export const RYLO_MAINNET_IMAGE_URL = "https://orrylo.com/brand/rylo-logo.webp";

/**
 * Canonical RYLO Mainnet identity metadata. This does not assert issuance,
 * locked supply, market liquidity, or a deployed Soroban asset contract.
 */
export function renderRyloMainnetToml(): string {
  const content = `NETWORK_PASSPHRASE = "${RYLO_MAINNET_NETWORK_PASSPHRASE}"
ACCOUNTS = ["${RYLO_ISSUER_CANDIDATE}"]

[DOCUMENTATION]
ORG_NAME = "Orrylo"
ORG_URL = "https://orrylo.com"
ORG_DESCRIPTION = "Orrylo builds and manages Stellar-based token projects and services."
ORG_LOGO = "${ORRYLO_METADATA_LOGO_URL}"

[[CURRENCIES]]
code = "RYLO"
issuer = "${RYLO_ISSUER_CANDIDATE}"
display_decimals = 7
name = "RYLO"
desc = "RYLO is an independent, transferable Stellar asset. It is not required to use Orrylo services. Liquidity, market value, and returns are not guaranteed."
image = "${RYLO_MAINNET_IMAGE_URL}"
is_asset_anchored = false
`;

  if (
    content.includes(RYLO_ABANDONED_TESTNET_ISSUER) ||
    content.includes(RYLO_TESTNET_ISSUER)
  ) {
    throw new Error("invalid_rylo_mainnet_metadata_issuer");
  }

  return content;
}
