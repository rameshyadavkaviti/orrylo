import { Keypair } from "@stellar/stellar-sdk/base";

export class InvalidStellarPublicKeyError extends Error {
  constructor() {
    super("Invalid Stellar public key.");
    this.name = "InvalidStellarPublicKeyError";
  }
}

export function normalizeWalletPublicKey(publicKey: string): string {
  const trimmed = publicKey.trim();

  try {
    return Keypair.fromPublicKey(trimmed).publicKey();
  } catch {
    throw new InvalidStellarPublicKeyError();
  }
}
