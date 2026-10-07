import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk/base";

export interface AlbedoPublicKeyProof {
  pubkey: string;
  signed_message: string;
  signature: string;
}

export type AlbedoProofFailure =
  | "invalid_public_key"
  | "signed_message_mismatch"
  | "invalid_signature_format"
  | "invalid_signature";

export type AlbedoProofVerification =
  { ok: true; publicKey: string } | { ok: false; reason: AlbedoProofFailure };

export function verifyAlbedoPublicKeyProof(
  challengePayload: string,
  proof: AlbedoPublicKeyProof,
): AlbedoProofVerification {
  const expectedSignedMessage = `${proof.pubkey}:${challengePayload}`;

  if (proof.signed_message !== expectedSignedMessage) {
    return { ok: false, reason: "signed_message_mismatch" };
  }

  if (!/^[0-9a-f]{128}$/i.test(proof.signature)) {
    return { ok: false, reason: "invalid_signature_format" };
  }

  let keypair: Keypair;

  try {
    keypair = Keypair.fromPublicKey(proof.pubkey);
  } catch {
    return { ok: false, reason: "invalid_public_key" };
  }

  const digest = createHash("sha256")
    .update(proof.signed_message, "utf8")
    .digest();
  const signature = Buffer.from(proof.signature, "hex");

  if (!keypair.verify(digest, signature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true, publicKey: proof.pubkey };
}
