import assert from "node:assert/strict";
import test from "node:test";

import { createAuthChallenge } from "../lib/auth/challenge";
import { AUTH_PURPOSE, CHALLENGE_TTL_MS } from "../lib/auth/constants";
import { MemoryChallengeStore } from "../lib/auth/stores";

test("creates a purpose/domain/network-bound short-lived challenge", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z");
  const nonce = "n".repeat(43);
  const challenge = createAuthChallenge({
    domain: "app.orrylo.com",
    network: "testnet",
    now,
    nonce,
  });

  assert.equal(challenge.id, nonce);
  assert.equal(challenge.purpose, AUTH_PURPOSE);
  assert.equal(challenge.expiresAt - challenge.issuedAt, CHALLENGE_TTL_MS);
  assert.match(challenge.payload, /purpose=orrylo-wallet-auth-v1/);
  assert.match(challenge.payload, /domain=app\.orrylo\.com/);
  assert.match(challenge.payload, /network=testnet/);
  assert.match(challenge.payload, new RegExp(`nonce=${nonce}`));
});

test("expired challenges are rejected and consumed", () => {
  const now = 1_000_000;
  const store = new MemoryChallengeStore();
  const challenge = createAuthChallenge({
    domain: "localhost",
    network: "testnet",
    now,
    nonce: "x".repeat(43),
  });

  store.put(challenge);

  assert.deepEqual(store.consume(challenge.id, challenge.expiresAt), {
    ok: false,
    reason: "expired",
  });
  assert.deepEqual(store.consume(challenge.id, challenge.expiresAt), {
    ok: false,
    reason: "missing",
  });
});
