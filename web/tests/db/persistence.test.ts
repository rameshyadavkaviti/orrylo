import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { createAuthChallenge } from "../../lib/auth/challenge";
import { CHALLENGE_TTL_MS, SESSION_TTL_MS } from "../../lib/auth/constants";
import { IdempotencyPayloadMismatchError } from "../../lib/persistence/workflows";
import {
  PostgresAuditRepository,
  hashAuditEvent,
} from "../../lib/server/persistence/audit-repository";
import {
  PostgresChallengeStore,
  PostgresSessionStore,
  hashSessionToken,
} from "../../lib/server/persistence/auth-repositories";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "../../lib/server/persistence/database";
import { PostgresFutureDomainRepository } from "../../lib/server/persistence/future-domain-repository";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import { PostgresWorkflowRepository } from "../../lib/server/persistence/workflow-repository";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

if (!TEST_DATABASE_URL) {
  test("PostgreSQL persistence integration suite", { skip: true }, () => {});
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);
  const migrationsDirectory = resolve(process.cwd(), "db/migrations");
  const NOW = Date.parse("2026-10-07T13:00:00.000Z");
  const PUBLIC_KEY = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, 17),
  ).publicKey();

  before(async () => {
    assertDedicatedTestDatabase(databaseUrl);
    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await migrateDatabase(sql, migrationsDirectory);
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql.unsafe(`
      TRUNCATE TABLE
        protected_operation_intents,
        reward_records,
        token_creation_qualifying_events,
        eligibility_records,
        audit_events,
        workflow_intents,
        auth_sessions,
        auth_challenges
      RESTART IDENTITY CASCADE
    `);
    await sql`
      UPDATE audit_chain_heads
      SET last_sequence = 0, last_event_hash = NULL
      WHERE chain_id = 'application'
    `;
  });

  test("migration bootstrap is repeatable and schema-complete", async () => {
    const result = await migrateDatabase(sql, migrationsDirectory);

    assert.equal(result.applied.length, 0);
    assert.deepEqual(result.verified, [
      "001_application_persistence.sql",
      "002_reward_wallet_type_uniqueness.sql",
      "003_eligibility_reward_workflow.sql",
    ]);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'auth_challenges',
          'auth_sessions',
          'workflow_intents',
          'audit_events',
          'eligibility_records',
          'reward_records',
          'protected_operation_intents',
          'token_creation_qualifying_events'
        )
    `;

    assert.equal(count, "8");
  });

  test("challenge persists across repository instances and consumes once", async () => {
    const first = new PostgresChallengeStore(sql);
    const second = new PostgresChallengeStore(sql);
    const challenge = createAuthChallenge({
      domain: "app.orrylo.com",
      network: "testnet",
      now: NOW,
      nonce: "p".repeat(43),
    });

    await first.put(challenge);

    const consumed = await second.consume(challenge.id, NOW + 1);
    assert.equal(consumed.ok, true);
    assert.deepEqual(await first.consume(challenge.id, NOW + 2), {
      ok: false,
      reason: "missing",
    });
  });

  test("concurrent challenge replay permits exactly one consumer", async () => {
    const first = new PostgresChallengeStore(sql);
    const second = new PostgresChallengeStore(sql);
    const challenge = createAuthChallenge({
      domain: "app.orrylo.com",
      network: "testnet",
      now: NOW,
      nonce: "q".repeat(43),
    });

    await first.put(challenge);

    const results = await Promise.all([
      first.consume(challenge.id, NOW + 1),
      second.consume(challenge.id, NOW + 1),
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(
      results.filter((result) => !result.ok && result.reason === "missing")
        .length,
      1,
    );
  });

  test("persistent challenge expiry is enforced", async () => {
    const store = new PostgresChallengeStore(sql);
    const challenge = createAuthChallenge({
      domain: "app.orrylo.com",
      network: "testnet",
      now: NOW,
      nonce: "r".repeat(43),
    });

    await store.put(challenge);
    assert.deepEqual(
      await store.consume(challenge.id, NOW + CHALLENGE_TTL_MS),
      { ok: false, reason: "expired" },
    );
  });

  test("session survives store instances, stores only its hash, expires, and logs out", async () => {
    const first = new PostgresSessionStore(sql);
    const second = new PostgresSessionStore(sql);
    const created = await first.create(PUBLIC_KEY, NOW);

    assert.equal(
      (await second.get(created.token, NOW + 1))?.publicKey,
      PUBLIC_KEY,
    );

    const [stored] = await sql<{ token_hash: string }[]>`
      SELECT token_hash
      FROM auth_sessions
    `;

    assert.ok(stored);
    assert.equal(stored.token_hash.trim(), hashSessionToken(created.token));
    assert.notEqual(stored.token_hash.trim(), created.token);

    assert.equal(await second.get(created.token, NOW + SESSION_TTL_MS), null);

    const active = await first.create(PUBLIC_KEY, NOW);
    await second.destroy(active.token, NOW + 2);
    assert.equal(await first.get(active.token, NOW + 3), null);
  });

  test("concurrent idempotent workflow creation returns one logical intent", async () => {
    const first = new PostgresWorkflowRepository(sql);
    const second = new PostgresWorkflowRepository(sql);
    const input = {
      workflowScope: "test:future-operation",
      workflowType: "future_operation",
      subjectPublicKey: PUBLIC_KEY,
      idempotencyKey: "same-request",
      payload: { action: "placeholder", amount: "10" },
      policyVersion: "test-policy",
    } as const;

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 === 0 ? first : second).createIdempotent(input, NOW),
      ),
    );

    assert.equal(new Set(results.map((row) => row.requestId)).size, 1);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM workflow_intents
      WHERE workflow_scope = ${input.workflowScope}
        AND idempotency_key = ${input.idempotencyKey}
    `;
    assert.equal(count, "1");

    assert.equal(
      (await first.getByIdempotency(input.workflowScope, input.idempotencyKey))
        ?.requestId,
      results[0]?.requestId,
    );
  });

  test("idempotency payload mismatch fails explicitly", async () => {
    const repository = new PostgresWorkflowRepository(sql);
    const base = {
      workflowScope: "test:mismatch",
      workflowType: "future_operation",
      idempotencyKey: "stable-key",
      policyVersion: "test-policy",
    };

    await repository.createIdempotent({ ...base, payload: { value: 1 } }, NOW);

    await assert.rejects(
      repository.createIdempotent({ ...base, payload: { value: 2 } }, NOW + 1),
      IdempotencyPayloadMismatchError,
    );
  });

  test("terminal workflow states cannot transition through repository CAS", async () => {
    const repository = new PostgresWorkflowRepository(sql);
    const terminalStates = ["confirmed", "failed", "cancelled"] as const;

    for (const terminalState of terminalStates) {
      const idempotencyKey = `terminal-${terminalState}`;
      const created = await repository.createIdempotent(
        {
          workflowScope: "test:terminal",
          workflowType: "future_operation",
          idempotencyKey,
          payload: { terminalState },
          policyVersion: "test-policy",
        },
        NOW,
      );
      const terminal = await repository.compareAndSetState({
        requestId: created.requestId,
        expectedState: "created",
        nextState: terminalState,
        now: NOW + 1,
      });

      assert.ok(terminal);
      assert.equal(terminal.state, terminalState);
      assert.ok(terminal.terminalAt);

      const reopened = await repository.compareAndSetState({
        requestId: created.requestId,
        expectedState: terminalState,
        nextState: "created",
        now: NOW + 2,
      });

      assert.equal(reopened, null);
      const persisted = await repository.getByIdempotency(
        "test:terminal",
        idempotencyKey,
      );
      assert.equal(persisted?.state, terminalState);
      assert.equal(persisted?.terminalAt, terminal.terminalAt);
    }
  });
  test("audit events append in a deterministic verifiable hash chain", async () => {
    const repository = new PostgresAuditRepository(sql);
    const first = await repository.append({
      eventType: "test.created",
      source: "system",
      targetPublicKey: PUBLIC_KEY,
      occurredAt: NOW,
      policyVersion: "test-policy",
      metadata: { safe: true, nested: { value: "one" } },
    });
    const second = await repository.append({
      requestId: null,
      eventType: "test.checked",
      source: "system",
      targetPublicKey: PUBLIC_KEY,
      occurredAt: NOW + 1,
      policyVersion: "test-policy",
      metadata: { safe: true, value: 2 },
    });

    assert.equal(first.sequence, "1");
    assert.equal(second.sequence, "2");
    assert.equal(second.previousEventHash, first.eventHash);
    assert.equal(await repository.verifyChain(), true);

    const deterministic = hashAuditEvent({
      eventId: first.eventId,
      sequence: first.sequence,
      requestId: first.requestId,
      eventType: first.eventType,
      source: first.source,
      targetPublicKey: first.targetPublicKey,
      occurredAt: first.occurredAt,
      policyVersion: first.policyVersion,
      metadata: first.metadata,
      previousEventHash: first.previousEventHash,
    });
    assert.equal(deterministic, first.eventHash);

    await assert.rejects(
      sql`
        UPDATE audit_events
        SET event_type = 'tampered'
        WHERE event_id = ${first.eventId}
      `,
      /append-only/,
    );
  });

  test("audit verification rejects stored head hash and sequence mismatches", async () => {
    const repository = new PostgresAuditRepository(sql);
    const event = await repository.append({
      eventType: "test.head",
      source: "system",
      occurredAt: NOW,
      policyVersion: "test-policy",
      metadata: { safe: true },
    });

    await sql`
      UPDATE audit_chain_heads
      SET last_event_hash = ${"0".repeat(64)}
      WHERE chain_id = 'application'
    `;
    assert.equal(await repository.verifyChain(), false);

    await sql`
      UPDATE audit_chain_heads
      SET last_sequence = 2, last_event_hash = ${event.eventHash}
      WHERE chain_id = 'application'
    `;
    assert.equal(await repository.verifyChain(), false);
  });

  test("audit verification rejects missing tail history", async () => {
    const repository = new PostgresAuditRepository(sql);
    await repository.append({
      eventType: "test.first",
      source: "system",
      occurredAt: NOW,
      policyVersion: "test-policy",
      metadata: { safe: true },
    });
    const tail = await repository.append({
      eventType: "test.tail",
      source: "system",
      occurredAt: NOW + 1,
      policyVersion: "test-policy",
      metadata: { safe: true },
    });

    await sql.unsafe(
      "ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only",
    );
    try {
      await sql`DELETE FROM audit_events WHERE event_id = ${tail.eventId}`;
    } finally {
      await sql.unsafe(
        "ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only",
      );
    }

    assert.equal(await repository.verifyChain(), false);
  });

  test("audit verification rejects empty history with a non-empty head", async () => {
    const repository = new PostgresAuditRepository(sql);

    await sql`
      UPDATE audit_chain_heads
      SET last_sequence = 1, last_event_hash = ${"f".repeat(64)}
      WHERE chain_id = 'application'
    `;

    assert.equal(await repository.verifyChain(), false);
  });
  test("eligibility and wallet/type reward uniqueness constraints prevent duplicates", async () => {
    const repository = new PostgresFutureDomainRepository(sql);

    const eligibility = {
      walletPublicKey: PUBLIC_KEY,
      eligibilityType: "test-qualification",
      reason: "integration-test",
      becameEligibleAt: NOW,
      policyVersion: "test-policy",
    };

    assert.equal(
      (await repository.createEligibility(eligibility)).created,
      true,
    );
    assert.equal(
      (await repository.createEligibility(eligibility)).created,
      false,
    );

    const rewardBase = {
      walletPublicKey: PUBLIC_KEY,
      rewardType: "test-first-token",
      amount: "1.0000000",
      policyVersion: "test-policy",
      now: NOW,
    };

    assert.equal(
      (
        await repository.createReward({
          ...rewardBase,
          idempotencyKey: "reward-1",
          rewardUniquenessKey: "first-token:" + PUBLIC_KEY,
        })
      ).created,
      true,
    );

    assert.equal(
      (
        await repository.createReward({
          ...rewardBase,
          idempotencyKey: "reward-2",
          rewardUniquenessKey: "caller-bypass-attempt:" + PUBLIC_KEY,
        })
      ).created,
      false,
    );

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM reward_records
      WHERE wallet_public_key = ${PUBLIC_KEY}
        AND reward_type = ${rewardBase.rewardType}
    `;
    assert.equal(count, "1");
  });
}

function assertDedicatedTestDatabase(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.slice(1);

  if (!/test/i.test(databaseName)) {
    throw new Error(
      "TEST_DATABASE_URL must point to a database whose name contains 'test'.",
    );
  }
}
