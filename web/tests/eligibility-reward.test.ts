import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@stellar/stellar-sdk/base";

import {
  isWithinRewardWindow,
  normalizeStellarPublicKey,
  parseOfficialLaunchAt,
  REWARD_WINDOW_MS,
} from "../lib/server/eligibility-reward/service";

const KEY = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();

test("Stellar StrKey validation accepts valid keys and rejects bad checksums", () => {
  assert.equal(normalizeStellarPublicKey(KEY.toLowerCase()), KEY);
  const last = KEY.at(-1);
  assert.throws(() => normalizeStellarPublicKey(KEY.slice(0, -1) + (last === "A" ? "B" : "A")));
  assert.throws(() => normalizeStellarPublicKey("G" + "A".repeat(55)));
});

test("official launch config is optional but strictly UTC formatted", () => {
  assert.equal(parseOfficialLaunchAt(undefined), null);
  assert.equal(parseOfficialLaunchAt(""), null);
  assert.equal(parseOfficialLaunchAt("2026-10-08T00:00:00.000Z"), Date.UTC(2026, 9, 8));
  assert.throws(() => parseOfficialLaunchAt("2026-10-08"));
  assert.throws(() => parseOfficialLaunchAt("2026-02-30T00:00:00.000Z"));
  assert.throws(() => parseOfficialLaunchAt("2026-10-08T00:00:00+00:00"));
});

test("60-day launch window is half-open [launch, launch + 60 days)", () => {
  const launch = Date.UTC(2026, 9, 8);
  assert.equal(isWithinRewardWindow(launch - 1, launch), false);
  assert.equal(isWithinRewardWindow(launch, launch), true);
  assert.equal(isWithinRewardWindow(launch + 30 * 86_400_000, launch), true);
  assert.equal(isWithinRewardWindow(launch + REWARD_WINDOW_MS - 1, launch), true);
  assert.equal(isWithinRewardWindow(launch + REWARD_WINDOW_MS, launch), false);
  assert.equal(isWithinRewardWindow(launch + REWARD_WINDOW_MS + 1, launch), false);
});
