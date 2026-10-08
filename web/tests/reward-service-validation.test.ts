import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import type { DatabaseClient } from "../lib/server/persistence/database";
import { EligibilityRewardService } from "../lib/server/rewards/service";

test("invalid event timestamps return a typed error before database access", async () => {
  const sql = {
    begin: async () => {
      throw new Error("Invalid timestamp reached the database.");
    },
  } as unknown as DatabaseClient;
  const service = new EligibilityRewardService(sql);

  for (const eventOccurredAt of [
    NaN,
    Infinity,
    -Infinity,
    1e20,
    -1e20,
    Date.parse("-010000-01-01T00:00:00.000Z"),
  ]) {
    const result = await service.processTrustedTokenCreationSucceeded({
      eventReference: "invalid-timestamp-event",
      walletPublicKey: Keypair.fromRawEd25519Seed(
        Buffer.alloc(32, 33),
      ).publicKey(),
      eventType: "TOKEN_CREATION_SUCCEEDED",
      eventOccurredAt,
      source: "trusted-token-creation-service",
      policyVersion: "rylo-v1-test",
    });
    assert.deepEqual(result, {
      outcome: "invalid_event",
      code: "invalid_event_timestamp",
    });
  }
});
