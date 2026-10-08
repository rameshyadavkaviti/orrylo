import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk/base";

import { PostgresAuditRepository } from "../../lib/server/persistence/audit-repository";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "../../lib/server/persistence/database";
import { migrateDatabase } from "../../lib/server/persistence/migrations";
import {
  FIRST_TOKEN_ELIGIBILITY_TYPE,
  FIRST_TOKEN_REWARD_TYPE,
  REWARD_WINDOW_MS,
} from "../../lib/server/rewards/policy";
import { EligibilityRewardService } from "../../lib/server/rewards/service";
import type { TrustedTokenCreationSucceededEvent } from "../../lib/server/rewards/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();
const LAUNCH_AT = Date.parse("2026-10-08T00:00:00.000Z");
const POLICY_VERSION = "rylo-v1-test";

if (!TEST_DATABASE_URL) {
  test(
    "Eligibility/reward PostgreSQL integration suite",
    { skip: true },
    () => {},
  );
} else {
  const databaseUrl = TEST_DATABASE_URL;
  const sql = createDatabaseClient(databaseUrl);

  before(async () => {
    assertDedicatedTestDatabase(databaseUrl);
    await resetSchema(sql);
  });

  after(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetFeatureState(sql);
  });

  test("missing launch config establishes one durable eligibility and replays the stored result", async () => {
    const now = LAUNCH_AT + 1_000;
    const event = qualifyingEvent(1);
    const service = new EligibilityRewardService(sql, { now: () => now });

    const first = await service.processTrustedTokenCreationSucceeded(event);
    const replay = await service.processTrustedTokenCreationSucceeded(event);

    assert.equal(first.outcome, "processed");
    assert.deepEqual(replay, first);
    if (first.outcome !== "processed") return;
    assert.equal(first.eligibility.outcome, "eligibility_established");
    assert.deepEqual(first.reward, { outcome: "launch_not_configured" });

    const [counts] = await sql<
      {
        events: string;
        eligibility: string;
        rewards: string;
        workflows: string;
        operations: string;
      }[]
    >`
      SELECT
        (SELECT count(*)::text FROM token_creation_qualifying_events) AS events,
        (SELECT count(*)::text FROM eligibility_records) AS eligibility,
        (SELECT count(*)::text FROM reward_records) AS rewards,
        (SELECT count(*)::text FROM workflow_intents) AS workflows,
        (SELECT count(*)::text FROM protected_operation_intents) AS operations
    `;
    assert.deepEqual(counts, {
      events: "1",
      eligibility: "1",
      rewards: "0",
      workflows: "0",
      operations: "0",
    });

    const [eligibility] = await sql<
      {
        wallet_public_key: string;
        eligibility_type: string;
        became_eligible_at: Date;
        policy_version: string;
        qualifying_event_reference: string;
      }[]
    >`
      SELECT
        wallet_public_key,
        eligibility_type,
        became_eligible_at,
        policy_version,
        qualifying_event_reference
      FROM eligibility_records
    `;
    assert.equal(eligibility.wallet_public_key.trim(), event.walletPublicKey);
    assert.equal(eligibility.eligibility_type, FIRST_TOKEN_ELIGIBILITY_TYPE);
    assert.equal(eligibility.became_eligible_at.getTime(), now);
    assert.equal(eligibility.policy_version, POLICY_VERSION);
    assert.equal(eligibility.qualifying_event_reference, event.eventReference);

    const audit = await new PostgresAuditRepository(sql).list();
    assert.deepEqual(
      audit.map((item) => item.eventType),
      [
        "eligibility.established",
        "reward.evaluated",
        "reward.skipped.launch_not_configured",
      ],
    );
    assert.equal(await new PostgresAuditRepository(sql).verifyChain(), true);
  });

  test("launch boundary approves exactly 150 RYLO and creates inactive future intents once", async () => {
    const event = qualifyingEvent(2, { lowercaseWallet: true });
    const service = serviceAt(sql, LAUNCH_AT);

    const first = await service.processTrustedTokenCreationSucceeded(event);
    const replay = await service.processTrustedTokenCreationSucceeded(event);

    assert.deepEqual(replay, first);
    assert.equal(first.outcome, "processed");
    if (first.outcome !== "processed") return;
    assert.equal(first.walletPublicKey, event.walletPublicKey.toUpperCase());
    assert.equal(first.reward.outcome, "reward_approved");
    if (first.reward.outcome !== "reward_approved") return;
    assert.equal(first.reward.amount, "150.0000000");

    const [reward] = await sql<
      {
        reward_id: string;
        amount: string;
        status: string;
        qualifying_event_reference: string;
        launch_window_evidence: {
          evaluatedAt: string;
          interval: string;
          launchAt: string;
          windowEnd: string;
        };
        policy_version: string;
        onchain_transaction_reference: string | null;
      }[]
    >`
      SELECT
        reward_id,
        amount::text AS amount,
        status,
        qualifying_event_reference,
        launch_window_evidence,
        policy_version,
        onchain_transaction_reference
      FROM reward_records
    `;
    assert.equal(reward.reward_id, first.reward.rewardId);
    assert.equal(reward.amount, "150.0000000");
    assert.equal(reward.status, "approved");
    assert.equal(reward.qualifying_event_reference, event.eventReference);
    assert.deepEqual(reward.launch_window_evidence, {
      evaluatedAt: "2026-10-08T00:00:00.000Z",
      interval: "[launch_at, window_end)",
      launchAt: "2026-10-08T00:00:00.000Z",
      windowEnd: "2026-12-07T00:00:00.000Z",
    });
    assert.equal(reward.policy_version, POLICY_VERSION);
    assert.equal(reward.onchain_transaction_reference, null);

    const [workflow] = await sql<
      {
        request_id: string;
        state: string;
        payload: Record<string, unknown>;
        external_reference: string | null;
        onchain_reference: string | null;
      }[]
    >`
      SELECT request_id, state, payload, external_reference, onchain_reference
      FROM workflow_intents
    `;
    assert.equal(workflow.request_id, first.reward.workflowRequestId);
    assert.equal(workflow.state, "approved");
    assert.equal(workflow.external_reference, null);
    assert.equal(workflow.onchain_reference, null);
    assert.deepEqual(workflow.payload, {
      amount: "150.0000000",
      qualifyingEventReference: event.eventReference,
      rewardId: first.reward.rewardId,
      rewardType: FIRST_TOKEN_REWARD_TYPE,
      walletPublicKey: event.walletPublicKey.toUpperCase(),
    });

    const [operation] = await sql<
      {
        operation_id: string;
        operation_type: string;
        parameters: Record<string, unknown>;
      }[]
    >`
      SELECT operation_id, operation_type, parameters
      FROM protected_operation_intents
    `;
    assert.equal(operation.operation_id, first.reward.protectedOperationId);
    assert.equal(operation.operation_type, "mint");
    assert.deepEqual(operation.parameters, {
      amount: "150.0000000",
      execution: "future_reward_mint",
      qualifyingEventReference: event.eventReference,
      rewardId: first.reward.rewardId,
      rewardType: FIRST_TOKEN_REWARD_TYPE,
    });
    assert.equal("transactionEnvelope" in operation.parameters, false);
  });

  test("reward window excludes before launch and the exact 60-day end", async () => {
    const before = await serviceAt(
      sql,
      LAUNCH_AT - 1,
    ).processTrustedTokenCreationSucceeded(qualifyingEvent(3));
    const atEnd = await serviceAt(
      sql,
      LAUNCH_AT + REWARD_WINDOW_MS,
    ).processTrustedTokenCreationSucceeded(qualifyingEvent(4));

    assert.equal(before.outcome, "processed");
    assert.equal(atEnd.outcome, "processed");
    if (before.outcome !== "processed" || atEnd.outcome !== "processed") {
      return;
    }
    assert.deepEqual(before.reward, {
      outcome: "outside_reward_window",
      position: "before_launch",
    });
    assert.deepEqual(atEnd.reward, {
      outcome: "outside_reward_window",
      position: "after_window",
    });

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM reward_records
    `;
    assert.equal(count, "0");
  });

  test("later token creation cannot reward a first creation processed before launch", async () => {
    const firstEvent = qualifyingEvent(5, { walletSeed: 5 });
    const laterEvent = qualifyingEvent(6, { walletSeed: 5 });
    const first = await serviceAt(
      sql,
      LAUNCH_AT - 1,
    ).processTrustedTokenCreationSucceeded(firstEvent);
    const later = await serviceAt(
      sql,
      LAUNCH_AT + 1,
    ).processTrustedTokenCreationSucceeded(laterEvent);

    assert.equal(first.outcome, "processed");
    assert.equal(later.outcome, "processed");
    if (first.outcome !== "processed" || later.outcome !== "processed") return;
    assert.equal(later.eligibility.outcome, "eligibility_already_existed");
    assert.equal(
      later.eligibility.eligibilityId,
      first.eligibility.eligibilityId,
    );
    assert.deepEqual(later.reward, {
      outcome: "outside_reward_window",
      position: "before_launch",
    });
    await assertNoRewardIntents(sql);
  });

  test("later token creation cannot retroactively reward an unconfigured first creation", async () => {
    const firstEvent = qualifyingEvent(7, { walletSeed: 7 });
    const laterEvent = qualifyingEvent(8, { walletSeed: 7 });
    const first = await new EligibilityRewardService(sql, {
      now: () => LAUNCH_AT + 1,
    }).processTrustedTokenCreationSucceeded(firstEvent);
    const later = await serviceAt(
      sql,
      LAUNCH_AT + 2,
    ).processTrustedTokenCreationSucceeded(laterEvent);

    assert.equal(first.outcome, "processed");
    assert.equal(later.outcome, "processed");
    if (first.outcome !== "processed" || later.outcome !== "processed") return;
    assert.equal(
      later.eligibility.eligibilityId,
      first.eligibility.eligibilityId,
    );
    assert.deepEqual(later.reward, { outcome: "launch_not_configured" });
    await assertNoRewardIntents(sql);
  });

  test("concurrent distinct trusted events create one eligibility, reward, workflow, and protected operation", async () => {
    const service = serviceAt(sql, LAUNCH_AT + 1);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        service.processTrustedTokenCreationSucceeded(
          qualifyingEvent(index + 10, { walletSeed: 10 }),
        ),
      ),
    );

    assert.equal(
      results.filter(
        (result) =>
          result.outcome === "processed" &&
          result.eligibility.outcome === "eligibility_established",
      ).length,
      1,
    );
    assert.equal(
      results.filter(
        (result) =>
          result.outcome === "processed" &&
          result.reward.outcome === "reward_approved",
      ).length,
      1,
    );

    const [counts] = await sql<
      {
        events: string;
        eligibility: string;
        rewards: string;
        workflows: string;
        operations: string;
      }[]
    >`
      SELECT
        (SELECT count(*)::text FROM token_creation_qualifying_events) AS events,
        (SELECT count(*)::text FROM eligibility_records) AS eligibility,
        (SELECT count(*)::text FROM reward_records) AS rewards,
        (SELECT count(*)::text FROM workflow_intents) AS workflows,
        (SELECT count(*)::text FROM protected_operation_intents) AS operations
    `;
    assert.deepEqual(counts, {
      events: "12",
      eligibility: "1",
      rewards: "1",
      workflows: "1",
      operations: "1",
    });
    assert.equal(await new PostgresAuditRepository(sql).verifyChain(), true);
  });

  test("event-reference mutation is rejected without changing the original result", async () => {
    const service = serviceAt(sql, LAUNCH_AT + 1);
    const original = qualifyingEvent(30);
    const first = await service.processTrustedTokenCreationSucceeded(original);
    const conflict = await service.processTrustedTokenCreationSucceeded({
      ...original,
      source: "different-trusted-producer",
    });
    const replay = await service.processTrustedTokenCreationSucceeded(original);

    assert.deepEqual(conflict, {
      outcome: "invalid_event",
      code: "event_reference_conflict",
    });
    assert.deepEqual(replay, first);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM token_creation_qualifying_events
    `;
    assert.equal(count, "1");
  });

  test("existing reward audit evidence keeps the original qualifying event provenance", async () => {
    const service = serviceAt(sql, LAUNCH_AT + 1);
    const firstEvent = qualifyingEvent(40, { walletSeed: 40 });
    const laterEvent = qualifyingEvent(41, { walletSeed: 40 });

    await service.processTrustedTokenCreationSucceeded(firstEvent);
    const second =
      await service.processTrustedTokenCreationSucceeded(laterEvent);
    assert.equal(second.outcome, "processed");
    if (second.outcome !== "processed") return;
    assert.equal(second.reward.outcome, "reward_already_exists");

    const [audit] = await sql<
      { metadata: { qualifyingEventReference: string } }[]
    >`
      SELECT metadata
      FROM audit_events
      WHERE event_type = 'reward.already_exists'
    `;
    assert.equal(
      audit.metadata.qualifyingEventReference,
      firstEvent.eventReference,
    );
  });

  test("later token creation reuses an approved reward after the window without reopening its terminal workflow", async () => {
    const firstEvent = qualifyingEvent(42, { walletSeed: 42 });
    const laterEvent = qualifyingEvent(43, { walletSeed: 42 });
    const first = await serviceAt(
      sql,
      LAUNCH_AT + 1,
    ).processTrustedTokenCreationSucceeded(firstEvent);
    assert.equal(first.outcome, "processed");
    if (first.outcome !== "processed") return;
    assert.equal(first.reward.outcome, "reward_approved");
    if (first.reward.outcome !== "reward_approved") return;

    await sql`
      UPDATE workflow_intents
      SET state = 'cancelled', terminal_at = ${new Date(LAUNCH_AT + 2)}
      WHERE request_id = ${first.reward.workflowRequestId}
    `;
    const later = await serviceAt(
      sql,
      LAUNCH_AT + REWARD_WINDOW_MS,
    ).processTrustedTokenCreationSucceeded(laterEvent);
    assert.equal(later.outcome, "processed");
    if (later.outcome !== "processed") return;
    assert.deepEqual(later.reward, {
      ...first.reward,
      outcome: "reward_already_exists",
    });

    const [workflow] = await sql<{ state: string; terminal_at: Date }[]>`
      SELECT state, terminal_at
      FROM workflow_intents
      WHERE request_id = ${first.reward.workflowRequestId}
    `;
    assert.equal(workflow.state, "cancelled");
    assert.equal(workflow.terminal_at.getTime(), LAUNCH_AT + 2);
    assert.equal(await new PostgresAuditRepository(sql).verifyChain(), true);
  });

  test("protected-operation mismatch rejects reuse and rolls back the later event", async () => {
    const service = serviceAt(sql, LAUNCH_AT + 1);
    const firstEvent = qualifyingEvent(45, { walletSeed: 45 });
    const laterEvent = qualifyingEvent(46, { walletSeed: 45 });

    await service.processTrustedTokenCreationSucceeded(firstEvent);
    await sql`
      UPDATE protected_operation_intents
      SET parameters = ${sql.json({ execution: "tampered" })}
    `;

    await assert.rejects(
      service.processTrustedTokenCreationSucceeded(laterEvent),
      /Protected reward mint intent idempotency conflict/,
    );

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM token_creation_qualifying_events
    `;
    assert.equal(count, "1");
  });

  test("audit failure rolls back qualifying event, eligibility, reward, and intents", async () => {
    await sql`DELETE FROM audit_chain_heads WHERE chain_id = 'application'`;
    const service = serviceAt(sql, LAUNCH_AT + 1);

    try {
      await assert.rejects(
        service.processTrustedTokenCreationSucceeded(qualifyingEvent(50)),
        /Audit chain head is unavailable/,
      );

      const [counts] = await sql<
        {
          events: string;
          eligibility: string;
          rewards: string;
          workflows: string;
          operations: string;
        }[]
      >`
        SELECT
          (SELECT count(*)::text FROM token_creation_qualifying_events) AS events,
          (SELECT count(*)::text FROM eligibility_records) AS eligibility,
          (SELECT count(*)::text FROM reward_records) AS rewards,
          (SELECT count(*)::text FROM workflow_intents) AS workflows,
          (SELECT count(*)::text FROM protected_operation_intents) AS operations
      `;
      assert.deepEqual(counts, {
        events: "0",
        eligibility: "0",
        rewards: "0",
        workflows: "0",
        operations: "0",
      });
    } finally {
      await sql`
        INSERT INTO audit_chain_heads (chain_id, last_sequence, last_event_hash)
        VALUES ('application', 0, NULL)
        ON CONFLICT (chain_id) DO NOTHING
      `;
    }
  });

  test("invalid launch configuration fails before any database mutation", async () => {
    const service = new EligibilityRewardService(sql, {
      officialLaunchAt: "not-a-timestamp",
      now: () => LAUNCH_AT,
    });

    await assert.rejects(
      service.processTrustedTokenCreationSucceeded(qualifyingEvent(60)),
      /ORRYLO_OFFICIAL_LAUNCH_AT/,
    );

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT (
        (SELECT count(*) FROM token_creation_qualifying_events) +
        (SELECT count(*) FROM eligibility_records) +
        (SELECT count(*) FROM reward_records) +
        (SELECT count(*) FROM workflow_intents) +
        (SELECT count(*) FROM protected_operation_intents)
      )::text AS count
    `;
    assert.equal(count, "0");
  });
}

function serviceAt(sql: DatabaseClient, now: number): EligibilityRewardService {
  return new EligibilityRewardService(sql, {
    officialLaunchAt: "2026-10-08T00:00:00.000Z",
    now: () => now,
  });
}

async function assertNoRewardIntents(sql: DatabaseClient): Promise<void> {
  const [counts] = await sql<
    { rewards: string; workflows: string; operations: string }[]
  >`
    SELECT
      (SELECT count(*)::text FROM reward_records) AS rewards,
      (SELECT count(*)::text FROM workflow_intents) AS workflows,
      (SELECT count(*)::text FROM protected_operation_intents) AS operations
  `;
  assert.deepEqual(counts, { rewards: "0", workflows: "0", operations: "0" });
  assert.equal(await new PostgresAuditRepository(sql).verifyChain(), true);
}

function qualifyingEvent(
  index: number,
  options: { lowercaseWallet?: boolean; walletSeed?: number } = {},
): TrustedTokenCreationSucceededEvent {
  const publicKey = Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, options.walletSeed ?? index),
  ).publicKey();

  return {
    eventReference: `token-creation-succeeded-${index}`,
    walletPublicKey: options.lowercaseWallet
      ? publicKey.toLowerCase()
      : publicKey,
    eventType: "TOKEN_CREATION_SUCCEEDED",
    eventOccurredAt: LAUNCH_AT - 500,
    associatedReference: `asset-${index}`,
    source: "trusted-token-creation-service",
    policyVersion: POLICY_VERSION,
  };
}

async function resetSchema(sql: DatabaseClient): Promise<void> {
  await sql.unsafe("DROP SCHEMA public CASCADE");
  await sql.unsafe("CREATE SCHEMA public");
  await migrateDatabase(sql, resolve(process.cwd(), "db/migrations"));
}

async function resetFeatureState(sql: DatabaseClient): Promise<void> {
  await sql.unsafe(`
    TRUNCATE TABLE
      protected_operation_intents,
      reward_records,
      token_creation_qualifying_events,
      eligibility_records,
      audit_events,
      workflow_intents
    RESTART IDENTITY CASCADE
  `);
  await sql`
    INSERT INTO audit_chain_heads (chain_id, last_sequence, last_event_hash)
    VALUES ('application', 0, NULL)
    ON CONFLICT (chain_id) DO UPDATE
    SET last_sequence = 0, last_event_hash = NULL
  `;
}

function assertDedicatedTestDatabase(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.slice(1);

  if (!/test/i.test(databaseName)) {
    throw new Error(
      "TEST_DATABASE_URL must point to a database whose name contains 'test'.",
    );
  }
}
