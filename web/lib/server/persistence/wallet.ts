const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

export function normalizeWalletPublicKey(publicKey: string): string {
  const normalized = publicKey.trim().toUpperCase();

  if (!STELLAR_PUBLIC_KEY.test(normalized)) {
    throw new Error("Invalid Stellar public key.");
  }

  return normalized;
}
