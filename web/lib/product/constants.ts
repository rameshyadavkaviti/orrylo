export const SHARED_ASSET_DOMAIN = "assets.orrylo.com";

export const SHARED_ISSUER_CANDIDATE =
  "GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS";

export const RYLO_ISSUER_CANDIDATE =
  "GCKB453UWEFLJQY4TVW7I7NZV3ZNVUCZZS6KKIKJZVF75WM2VEORRYLO";

export const RYLO_TESTNET_ISSUER =
  "GDNSIP2SKNJIKN6IG3XZBQMHIKKDET25J33F4R5V6DALKHIUDTVZOPKX";

export const RYLO_ABANDONED_TESTNET_ISSUER =
  "GDPKHRFAGZHDJFKLBERV7IXF2XX4TGW6MYYUDGME3MIJ3HES5SGICG5H";

/**
 * Canonical RYLO issuer identities recorded by docs/RYLO_POLICY.md section 2.
 * Shared Issuer customer-asset execution must reject every one of them.
 */
export const KNOWN_RYLO_ISSUER_PUBLIC_KEYS = [
  RYLO_ISSUER_CANDIDATE,
  RYLO_TESTNET_ISSUER,
  RYLO_ABANDONED_TESTNET_ISSUER,
] as const;

export function isKnownRyloIssuerPublicKey(publicKey: string): boolean {
  const normalized = publicKey.trim().toUpperCase();
  return KNOWN_RYLO_ISSUER_PUBLIC_KEYS.some(
    (knownIssuer) => knownIssuer === normalized,
  );
}

export function isForbiddenTestnetSharedIssuerPublicKey(
  publicKey: string,
): boolean {
  const normalized = publicKey.trim().toUpperCase();
  return (
    normalized === SHARED_ISSUER_CANDIDATE ||
    isKnownRyloIssuerPublicKey(normalized)
  );
}
