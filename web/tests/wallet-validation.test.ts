import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import {
  InvalidStellarPublicKeyError,
  normalizeWalletPublicKey,
} from "../lib/server/persistence/wallet";

test("valid Stellar public key is normalized through Stellar SDK", () => {
  const publicKey = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 33),
  ).publicKey();

  assert.equal(normalizeWalletPublicKey(`  ${publicKey}  `), publicKey);
  assert.equal(normalizeWalletPublicKey(publicKey.toLowerCase()), publicKey);
});

test("checksum-invalid Stellar public key is rejected", () => {
  const publicKey = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 34),
  ).publicKey();
  const replacement = publicKey.endsWith("A") ? "B" : "A";
  const checksumInvalid = publicKey.slice(0, -1) + replacement;

  assert.match(checksumInvalid, /^G[A-Z2-7]{55}$/);
  assert.throws(
    () => normalizeWalletPublicKey(checksumInvalid),
    InvalidStellarPublicKeyError,
  );
});
