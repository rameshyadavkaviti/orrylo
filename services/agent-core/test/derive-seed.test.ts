import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { deriveCognitiveSeed, seedVector } from "../src/identity/derive-seed.js";

const masterKey = "identity-master-key-for-tests-".repeat(2);

function publicKey(index: number): string {
  return Keypair.fromRawEd25519Seed(createHash("sha256").update(`agent-${index}`).digest()).publicKey();
}

test("derives the same persisted identity for the same wallet and version", () => {
  const first = deriveCognitiveSeed(masterKey, publicKey(1), 1);
  const second = deriveCognitiveSeed(masterKey, publicKey(1), 1);
  assert.deepEqual(first, second);
});

test("wallet and key version are part of identity derivation", () => {
  assert.notDeepEqual(
    deriveCognitiveSeed(masterKey, publicKey(1), 1),
    deriveCognitiveSeed(masterKey, publicKey(2), 1),
  );
  assert.notDeepEqual(
    deriveCognitiveSeed(masterKey, publicKey(1), 1),
    deriveCognitiveSeed(masterKey, publicKey(1), 2),
  );
});

test("initializes strong but individually variable RYLO motives", () => {
  const seeds = Array.from({ length: 20 }, (_, index) => deriveCognitiveSeed(masterKey, publicKey(index), 1));
  for (const seed of seeds) {
    assert.ok(seed.motives.ryloCompetitionDrive >= 0.82 && seed.motives.ryloCompetitionDrive <= 0.98);
    assert.ok(seed.motives.ryloAcquisitionDrive >= 0.78 && seed.motives.ryloAcquisitionDrive <= 0.96);
    assert.ok(seed.inhibitors.solvencyConcern >= 0.25 && seed.inhibitors.solvencyConcern <= 0.95);
    assert.ok(seed.plasticity.identityPerConsolidation <= 0.005);
  }
  assert.ok(new Set(seeds.map((seed) => seed.motives.ryloCompetitionDrive)).size > 15);
});

test("encodes correlated dispositions rather than independent trait labels", () => {
  const seeds = Array.from({ length: 40 }, (_, index) => deriveCognitiveSeed(masterKey, publicKey(index), 1));
  const highCompetition = seeds.filter((seed) => seed.motives.ryloCompetitionDrive > 0.91);
  assert.ok(highCompetition.length > 5);
  assert.ok(highCompetition.every((seed) => seed.sensitivities.relativeStatus > 0.52));
});

test("contains mechanisms and bounds but no direct action or guaranteed buy", () => {
  const seed = deriveCognitiveSeed(masterKey, publicKey(3), 1);
  const serialized = JSON.stringify(seed).toLowerCase();
  assert.equal(serialized.includes("buyaction"), false);
  assert.equal(serialized.includes("guaranteed"), false);
  assert.deepEqual(seed.availableActions, [
    "observe",
    "wait",
    "hold",
    "buy",
    "sell",
    "abstain",
    "exit",
    "claim",
    "defer",
    "decline",
  ]);
});

test("reference fixture identities remain materially separated", () => {
  const vectors = Array.from({ length: 12 }, (_, index) => seedVector(deriveCognitiveSeed(masterKey, publicKey(index), 1)));
  let minimum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const distance = Math.sqrt(vectors[i]!.reduce((sum, value, k) => sum + (value - vectors[j]![k]!) ** 2, 0) / vectors[i]!.length);
      minimum = Math.min(minimum, distance);
    }
  }
  assert.ok(minimum >= 0.05, `minimum normalized distance ${minimum} was below 0.05`);
});
