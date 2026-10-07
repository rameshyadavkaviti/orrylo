import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { CHALLENGE_TTL_MS } from "../lib/auth/constants";
import { WalletAuthService } from "../lib/auth/service";
import {
  MemoryChallengeStore,
  MemorySessionStore,
} from "./helpers/memory-auth-stores";

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
    signature: Buffer.from(signer.sign(digest)).toString("hex"),
  };
}

test("successful proof creates an authenticated session", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "a".repeat(43));
  const result = await service.verifyWallet(
    {
      challengeId: challenge.id,
      payload: challenge.payload,
      proof: proofFor(challenge.payload),
    },
    NOW + 1,
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.equal(
    (await service.getSession(result.sessionToken, NOW + 2))?.publicKey,
    proofFor(challenge.payload).pubkey,
  );
});

test("replayed challenge is rejected", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "b".repeat(43));
  const request = {
    challengeId: challenge.id,
    payload: challenge.payload,
    proof: proofFor(challenge.payload),
  };

  assert.equal((await service.verifyWallet(request, NOW + 1)).ok, true);
  assert.deepEqual(await service.verifyWallet(request, NOW + 2), {
    ok: false,
    code: "challenge_missing_or_used",
  });
});

test("modified challenge payload is rejected and burns the nonce", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "c".repeat(43));
  const modified = challenge.payload + "\nmodified=true";

  assert.deepEqual(
    await service.verifyWallet(
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
    await service.verifyWallet(
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

test("expired challenge is rejected", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "d".repeat(43));

  assert.deepEqual(
    await service.verifyWallet(
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

test("wrong signer and public-key mismatch are rejected", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "e".repeat(43));
  const signer = keypair(8);
  const claimed = keypair(9);
  const signedMessage = `${claimed.publicKey()}:${challenge.payload}`;
  const digest = createHash("sha256").update(signedMessage, "utf8").digest();

  const result = await service.verifyWallet(
    {
      challengeId: challenge.id,
      payload: challenge.payload,
      proof: {
        pubkey: claimed.publicKey(),
        signed_message: signedMessage,
        signature: Buffer.from(signer.sign(digest)).toString("hex"),
      },
    },
    NOW + 1,
  );

  assert.deepEqual(result, { ok: false, code: "invalid_signature" });
});

test("invalid signature is rejected", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "f".repeat(43));
  const proof = proofFor(challenge.payload);

  assert.deepEqual(
    await service.verifyWallet(
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

test("logout invalidates the session and missing session stays unauthenticated", async () => {
  const service = createService();

  assert.equal(await service.getSession(undefined, NOW), null);
  assert.equal(await service.getSession("missing", NOW), null);

  const challenge = await service.createChallenge(NOW, "g".repeat(43));
  const result = await service.verifyWallet(
    {
      challengeId: challenge.id,
      payload: challenge.payload,
      proof: proofFor(challenge.payload),
    },
    NOW + 1,
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.ok(await service.getSession(result.sessionToken, NOW + 2));
  await service.logout(result.sessionToken, NOW + 3);
  assert.equal(await service.getSession(result.sessionToken, NOW + 4), null);
});

test("rejects unknown challenge IDs", async () => {
  const service = createService();
  const payload = "Orrylo wallet authentication\\nunknown=true";

  assert.deepEqual(
    await service.verifyWallet(
      {
        challengeId: "z".repeat(43),
        payload,
        proof: proofFor(payload),
      },
      NOW + 1,
    ),
    { ok: false, code: "challenge_missing_or_used" },
  );
});

test("rejects challenge ID substitution", async () => {
  const service = createService();
  const first = await service.createChallenge(NOW, "h".repeat(43));
  const second = await service.createChallenge(NOW, "i".repeat(43));

  assert.deepEqual(
    await service.verifyWallet(
      {
        challengeId: second.id,
        payload: first.payload,
        proof: proofFor(first.payload),
      },
      NOW + 1,
    ),
    { ok: false, code: "challenge_mismatch" },
  );

  assert.equal(
    (
      await service.verifyWallet(
        {
          challengeId: first.id,
          payload: first.payload,
          proof: proofFor(first.payload),
        },
        NOW + 2,
      )
    ).ok,
    true,
  );

  assert.deepEqual(
    await service.verifyWallet(
      {
        challengeId: second.id,
        payload: second.payload,
        proof: proofFor(second.payload),
      },
      NOW + 3,
    ),
    { ok: false, code: "challenge_missing_or_used" },
  );
});

test("burns challenge after failed proof", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "j".repeat(43));
  const proof = proofFor(challenge.payload);

  assert.deepEqual(
    await service.verifyWallet(
      {
        challengeId: challenge.id,
        payload: challenge.payload,
        proof: { ...proof, signature: "00".repeat(64) },
      },
      NOW + 1,
    ),
    { ok: false, code: "invalid_signature" },
  );

  assert.deepEqual(
    await service.verifyWallet(
      {
        challengeId: challenge.id,
        payload: challenge.payload,
        proof,
      },
      NOW + 2,
    ),
    { ok: false, code: "challenge_missing_or_used" },
  );
});

test("rejects cross-context challenge reuse", async () => {
  const contexts = [
    { domain: "evil.example", network: "testnet" as const },
    { domain: "app.orrylo.com", network: "public" as const },
  ];

  for (const context of contexts) {
    const challenges = new MemoryChallengeStore();
    const sessions = new MemorySessionStore();
    const issuer = new WalletAuthService(
      { domain: "app.orrylo.com", network: "testnet" },
      challenges,
      sessions,
    );
    const verifier = new WalletAuthService(context, challenges, sessions);
    const nonce = randomNonce(context.domain + context.network);
    const challenge = await issuer.createChallenge(NOW, nonce);

    assert.deepEqual(
      await verifier.verifyWallet(
        {
          challengeId: challenge.id,
          payload: challenge.payload,
          proof: proofFor(challenge.payload),
        },
        NOW + 1,
      ),
      { ok: false, code: "challenge_mismatch" },
    );
  }
});

test("rejects signed-message substitution", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "k".repeat(43));
  const proof = proofFor(challenge.payload, keypair(10));

  assert.deepEqual(
    await service.verifyWallet(
      {
        challengeId: challenge.id,
        payload: challenge.payload,
        proof: {
          ...proof,
          signed_message: proof.signed_message + "x",
        },
      },
      NOW + 1,
    ),
    { ok: false, code: "signed_message_mismatch" },
  );
});

test("rejects public-key substitution", async () => {
  const service = createService();
  const challenge = await service.createChallenge(NOW, "l".repeat(43));
  const proof = proofFor(challenge.payload, keypair(10));

  assert.deepEqual(
    await service.verifyWallet(
      {
        challengeId: challenge.id,
        payload: challenge.payload,
        proof: {
          ...proof,
          pubkey: keypair(11).publicKey(),
        },
      },
      NOW + 1,
    ),
    { ok: false, code: "signed_message_mismatch" },
  );
});

function randomNonce(seed: string): string {
  return Buffer.from(seed.padEnd(32, "_")).toString("base64url").slice(0, 43);
}
