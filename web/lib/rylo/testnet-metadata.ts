import {
  RYLO_ABANDONED_TESTNET_ISSUER,
  RYLO_ISSUER_CANDIDATE,
  RYLO_TESTNET_ISSUER,
} from "../product/constants";

export const RYLO_TESTNET_HOME_DOMAIN = "orrylo.com";
export const RYLO_TESTNET_NETWORK_PASSPHRASE =
  "Test SDF Network ; September 2015";
export const ORRYLO_METADATA_LOGO_URL =
  "https://orrylo.com/brand/orrylo-logo.webp";
export const RYLO_TESTNET_IMAGE_URL = "https://orrylo.com/brand/rylo-logo.webp";

/**
 * Canonical repository-only RYLO Testnet metadata.
 *
 * This publishes identity and descriptive metadata only. It deliberately does
 * not publish supply, market data, Mainnet deployment, or SAC deployment claims.
 */
export function renderRyloTestnetToml(): string {
  const content = `NETWORK_PASSPHRASE = "${RYLO_TESTNET_NETWORK_PASSPHRASE}"
ACCOUNTS = ["${RYLO_TESTNET_ISSUER}"]

[DOCUMENTATION]
ORG_NAME = "Orrylo"
ORG_URL = "https://orrylo.com"
ORG_DESCRIPTION = "Orrylo builds and manages Stellar-based token projects and services."
ORG_LOGO = "${ORRYLO_METADATA_LOGO_URL}"

[[CURRENCIES]]
code = "RYLO"
issuer = "${RYLO_TESTNET_ISSUER}"
display_decimals = 7
name = "RYLO"
desc = "Orrylo ecosystem utility token for membership and paying for Orrylo services. Testnet asset; not positioned as an investment product."
image = "${RYLO_TESTNET_IMAGE_URL}"
is_asset_anchored = false
status = "test"
`;

  if (
    content.includes(RYLO_ABANDONED_TESTNET_ISSUER) ||
    content.includes(RYLO_ISSUER_CANDIDATE)
  ) {
    throw new Error("invalid_rylo_testnet_metadata_issuer");
  }

  return content;
}
