import type { VerifyWalletRequest } from "./service";

export function parseVerifyWalletRequest(
  input: unknown,
): VerifyWalletRequest | null {
  if (!isRecord(input) || !isRecord(input.proof)) {
    return null;
  }

  const proof = input.proof;

  if (
    typeof input.challengeId !== "string" ||
    typeof input.payload !== "string" ||
    typeof proof.pubkey !== "string" ||
    typeof proof.signed_message !== "string" ||
    typeof proof.signature !== "string"
  ) {
    return null;
  }

  if (
    input.challengeId.length < 20 ||
    input.payload.length < 20 ||
    input.payload.length > 4096 ||
    proof.pubkey.length > 128 ||
    proof.signed_message.length > 8192 ||
    proof.signature.length > 256
  ) {
    return null;
  }

  return {
    challengeId: input.challengeId,
    payload: input.payload,
    proof: {
      pubkey: proof.pubkey,
      signed_message: proof.signed_message,
      signature: proof.signature,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
