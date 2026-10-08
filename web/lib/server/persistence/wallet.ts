import { Keypair } from "@stellar/stellar-sdk/base";

export class InvalidStellarPublicKeyError extends Error {
  constructor() {
    super("Invalid Stellar public key.");
    this.name = "InvalidStellarPublicKeyError";
  }
}

export function normalizeWalletPublicKey(publicKey: string): string {
  const normalized = publicKey.trim().toUpperCase();

  try {
    return Keypair.fromPublicKey(normalized).publicKey();
  } catch {
    throw new InvalidStellarPublicKeyError();
  }
}
