import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { CHALLENGE_TTL_MS } from "../lib/auth/constants";
import { WalletAuthService } from "../lib/auth/service";
import { MemoryChallengeStore, MemorySessionStore } from "../lib/auth/stores";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function createService() {
  return new WalletAuthService(
    { domain: "app.orrylo.com", network: "testnet" },
    new MemoryChallengeStore(),
    new MemorySessionStore(),
  );
}

function keypair(byte: number) {
  return Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte));
}

function proofFor(payload: string, signer = keypair(7)) {
  const signedMessage = `${signer.publicKey()}:${payload}`;
  const digest = createHash("sha256").update(signedMessage, "utf8").digest();

  return {
    pubkey: signer.publicKey(),
    signed_message: signedMessage,
    signature: signer.sign(digest).toString("hex"),
  };
}

test("successful proof creates an authenticated session", () => {
  const service = createService();
  const challenge = service.createChallenge(NOW, "a".repeat(43));
  const result = service.verifyWallet(
    {
      challengeId: challenge.id,
      payload: challenge.payload,
      proof: proofFor(challenge.payload),
    },
    NOW + 1,
    "session-token",
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.equal(result.sessionToken, "session-token");
  assert.equal(
    service.getSession("session-token", NOW + 2)?.publicKey,
    proofFor(challenge.payload).pubkey,
  );
});

test("replayed challenge is rejected", () => {
  const service = createService();
  const challenge = service.createChallenge(NOW, "b".repeat(43));
  const request = {
    challengeId: challenge.id,
    payload: challenge.payload,
    proof: proofFor(challenge.payload),
  };

  assert.equal(service.verifyWallet(request, NOW + 1, "one").ok, true);
  assert.deepEqual(service.verifyWallet(request, NOW + 2, "two"), {
    ok: false,
    code: "challenge_missing_or_used",
  });
});

test("modified challenge payload is rejected and burns the nonce", () => {
  const service = createService();
  const challenge = service.createChallenge(NOW, "c".repeat(43));
  const modified = challenge.payload + "\nmodified=true";

  assert.deepEqual(
    service.verifyWallet(
      {
        challengeId: challenge.id,
        payload: modified,
        proof: proofFor(modified),
      },
      NOW + 1,
    ),
    { ok: false, code: "challenge_mismatch" },
  );

  assert.deepEqual(
    service.verifyWallet(
      {
        challengeId: challenge.id,
        payload: challenge.payload,
        proof: proofFor(challenge.payload),
      },
      NOW + 2,
    ),
    { ok: false, code: "challenge_missing_or_used" },
  );
});

test("expired challenge is rejected", () => {
  const service = createService();
  const challenge = service.createChallenge(NOW, "d".repeat(43));

  assert.deepEqual(
    service.verifyWallet(
      {
        challengeId: challenge.id,
        payload: challenge.payload,
        proof: proofFor(challenge.payload),
      },
      NOW + CHALLENGE_TTL_MS,
    ),
    { ok: false, code: "challenge_expired" },
  );
});

test("wrong signer and public-key mismatch are rejected", () => {
  const service = createService();
  const challenge = service.createChallenge(NOW, "e".repeat(43));
  const signer = keypair(8);
  const claimed = keypair(9);
  const signedMessage = `${claimed.publicKey()}:${challenge.payload}`;
  const digest = createHash("sha256").update(signedMessage, "utf8").digest();

  const result = service.verifyWallet(
    {
      challengeId: challenge.id,
      payload: challenge.payload,
      proof: {
        pubkey: claimed.publicKey(),
        signed_message: signedMessage,
        signature: signer.sign(digest).toString("hex"),
      },
    },
    NOW + 1,
  );

  assert.deepEqual(result, { ok: false, code: "invalid_signature" });
});

test("invalid signature is rejected", () => {
  const service = createService();
  const challenge = service.createChallenge(NOW, "f".repeat(43));
  const proof = proofFor(challenge.payload);

  assert.deepEqual(
    service.verifyWallet(
      {
        challengeId: challenge.id,
        payload: challenge.payload,
        proof: { ...proof, signature: "00".repeat(64) },
      },
      NOW + 1,
    ),
    { ok: false, code: "invalid_signature" },
  );
});

test("logout invalidates the session and missing session stays unauthenticated", () => {
  const service = createService();

  assert.equal(service.getSession(undefined, NOW), null);
  assert.equal(service.getSession("missing", NOW), null);

  const challenge = service.createChallenge(NOW, "g".repeat(43));
  const result = service.verifyWallet(
    {
      challengeId: challenge.id,
      payload: challenge.payload,
      proof: proofFor(challenge.payload),
    },
    NOW + 1,
    "logout-session",
  );

  assert.equal(result.ok, true);
  assert.ok(service.getSession("logout-session", NOW + 2));

  service.logout("logout-session");

  assert.equal(service.getSession("logout-session", NOW + 3), null);
});
