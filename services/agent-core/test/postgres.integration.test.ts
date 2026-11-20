import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { Pool } from "pg";

import { PostgresAgentRepository, RepositoryConflict } from "../src/db/repository.js";
import { createInitialState } from "../src/evolution/evolve.js";
import type { AgentEvent } from "../src/evolution/types.js";
import { deriveCognitiveSeed } from "../src/identity/derive-seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL serializes duplicate claims and preserves atomic state", { skip: !databaseUrl }, async () => {
  const schema = `agent_core_test_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 6, options: `-c search_path=${schema},public` });
  const repository = new PostgresAgentRepository(pool);
  try {
    await repository.migrate();
    const firstWallet = Keypair.random();
    const secondWallet = Keypair.random();
    const firstSeed = deriveCognitiveSeed("postgres-integration-master-".repeat(2), firstWallet.publicKey(), 1);
    const secondSeed = deriveCognitiveSeed("postgres-integration-master-".repeat(2), secondWallet.publicKey(), 1);
    const first = await repository.enroll({ alias: "FIRST", publicKey: firstWallet.publicKey(), seed: firstSeed, state: createInitialState(firstSeed) });
    const second = await repository.enroll({ alias: "SECOND", publicKey: secondWallet.publicKey(), seed: secondSeed, state: createInitialState(secondSeed) });
    const event: AgentEvent = {
      eventId: `parallel-${randomBytes(6).toString("hex")}`,
      type: "market_observation",
      sequence: 1,
      occurredAt: "2026-11-21T00:00:00.000Z",
      source: "postgres-integration",
      context: { contextTag: "market", scarcity: 0.6 },
    };
    const receipts = await Promise.all([
      repository.applyEvolution(first.id, event),
      repository.applyEvolution(first.id, event),
    ]);
    assert.deepEqual(receipts.map((receipt) => receipt.duplicate).sort(), [false, true]);
    assert.equal((await repository.get(first.id))?.revision, 1);

    await assert.rejects(
      () => repository.applyEvolution(second.id, event),
      (error: unknown) => error instanceof RepositoryConflict && error.code === "EVENT_ID_CONFLICT",
    );
    await assert.rejects(
      () => repository.applyEvolution(first.id, { ...event, eventId: `${event.eventId}-skipped`, sequence: 3 }),
      (error: unknown) => error instanceof RepositoryConflict && error.code === "SEQUENCE_CONFLICT",
    );
    assert.equal((await repository.get(first.id))?.revision, 1);
    assert.equal((await repository.metrics()).episodes, 1);
  } finally {
    await repository.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
