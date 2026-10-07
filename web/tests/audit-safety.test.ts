import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAuditMetadataSafe,
  hashAuditEvent,
} from "../lib/server/persistence/audit-repository";

test("audit hashing is deterministic", () => {
  const input = {
    eventId: "11111111-1111-4111-8111-111111111111",
    sequence: "1",
    requestId: null,
    eventType: "test.event",
    source: "system",
    targetPublicKey: null,
    occurredAt: Date.parse("2026-10-07T13:00:00.000Z"),
    policyVersion: "test-policy",
    metadata: { b: 2, a: { z: true, y: "safe" } },
    previousEventHash: null,
  } as const;

  assert.equal(hashAuditEvent(input), hashAuditEvent(input));
});

test("audit metadata rejects credential-like fields", () => {
  for (const metadata of [
    { secret: "x" },
    { nested: { seedPhrase: "x" } },
    { session_token: "x" },
    { signature: "x" },
    { privateKey: "x" },
    { credential: "x" },
    { password: "x" },
  ]) {
    assert.throws(() => assertAuditMetadataSafe(metadata), /sensitive/i);
  }
});
