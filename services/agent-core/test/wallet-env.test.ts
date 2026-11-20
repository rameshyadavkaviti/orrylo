import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { discoverWallets, verifyWalletCandidate } from "../src/enrollment/wallet-env.js";

test("discovers and verifies valid wallet pairs", () => {
  const wallet = Keypair.random();
  const result = discoverWallets({
    ORRYLO_AGENT_ALPHA_PUBLIC_KEY: wallet.publicKey(),
    ORRYLO_AGENT_ALPHA_SECRET_KEY: wallet.secret(),
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.wallets, [{ alias: "ALPHA", publicKey: wallet.publicKey() }]);
});

test("reports missing halves without exposing present secret", () => {
  const secret = Keypair.random().secret();
  const result = discoverWallets({ ORRYLO_AGENT_ALPHA_SECRET_KEY: secret });
  assert.equal(result.wallets.length, 0);
  assert.equal(result.issues[0]?.code, "MISSING_PUBLIC_KEY");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("rejects malformed aliases and malformed keys", () => {
  const wallet = Keypair.random();
  const malformedAlias = discoverWallets({
    ORRYLO_AGENT_bad_PUBLIC_KEY: wallet.publicKey(),
    ORRYLO_AGENT_bad_SECRET_KEY: wallet.secret(),
  });
  assert.equal(malformedAlias.issues[0]?.code, "MALFORMED_VARIABLE");

  const malformedKey = verifyWalletCandidate("ALPHA", "not-a-public-key", "not-a-secret");
  assert.equal(malformedKey.ok, false);
  if (!malformedKey.ok) assert.equal(malformedKey.issue.code, "MALFORMED_KEYPAIR");
});

test("rejects a secret that does not derive the configured public key", () => {
  const first = Keypair.random();
  const second = Keypair.random();
  const result = discoverWallets({
    ORRYLO_AGENT_ALPHA_PUBLIC_KEY: first.publicKey(),
    ORRYLO_AGENT_ALPHA_SECRET_KEY: second.secret(),
  });
  assert.equal(result.issues[0]?.code, "KEYPAIR_MISMATCH");
  assert.equal(result.wallets.length, 0);
});

test("rejects a public key configured under multiple aliases", () => {
  const wallet = Keypair.random();
  const result = discoverWallets({
    ORRYLO_AGENT_ALPHA_PUBLIC_KEY: wallet.publicKey(),
    ORRYLO_AGENT_ALPHA_SECRET_KEY: wallet.secret(),
    ORRYLO_AGENT_BETA_PUBLIC_KEY: wallet.publicKey(),
    ORRYLO_AGENT_BETA_SECRET_KEY: wallet.secret(),
  });
  assert.equal(result.wallets.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === "DUPLICATE_PUBLIC_KEY").length, 2);
});

test("never serializes wallet secrets in success or failure results", () => {
  const wallet = Keypair.random();
  const mismatch = Keypair.random();
  for (const env of [
    {
      ORRYLO_AGENT_ALPHA_PUBLIC_KEY: wallet.publicKey(),
      ORRYLO_AGENT_ALPHA_SECRET_KEY: wallet.secret(),
    },
    {
      ORRYLO_AGENT_ALPHA_PUBLIC_KEY: wallet.publicKey(),
      ORRYLO_AGENT_ALPHA_SECRET_KEY: mismatch.secret(),
    },
  ]) {
    const serialized = JSON.stringify(discoverWallets(env));
    assert.equal(serialized.includes(wallet.secret()), false);
    assert.equal(serialized.includes(mismatch.secret()), false);
  }
});

test("ignores the prefix configuration variable instead of treating it as a wallet", () => {
  const wallet = Keypair.random();
  const result = discoverWallets({
    ORRYLO_AGENT_ENV_PREFIX: "ORRYLO_AGENT_",
    ORRYLO_AGENT_ALPHA_PUBLIC_KEY: wallet.publicKey(),
    ORRYLO_AGENT_ALPHA_SECRET_KEY: wallet.secret(),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.wallets.length, 1);
});
