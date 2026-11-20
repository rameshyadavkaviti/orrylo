import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import type { Pool } from "pg";

import { createInitialState } from "../src/evolution/evolve.js";
import type { AgentEvent } from "../src/evolution/types.js";
import { deriveCognitiveSeed } from "../src/identity/derive-seed.js";
import { InMemoryAgentRepository, PostgresAgentRepository, RepositoryConflict } from "../src/db/repository.js";

const publicKey = Keypair.fromRawEd25519Seed(createHash("sha256").update("repo-agent").digest()).publicKey();
const seed = deriveCognitiveSeed("repository-test-master-".repeat(2), publicKey, 1);

function agentInput(alias = "ALPHA", key = publicKey) {
  return { alias, publicKey: key, seed, state: createInitialState(seed) };
}

function event(sequence = 1, eventId = `event-${sequence}`): AgentEvent {
  return {
    eventId,
    type: "market_observation",
    sequence,
    occurredAt: "2026-11-21T00:00:00.000Z",
    source: "test",
    context: { contextTag: "market", scarcity: 0.5 },
  };
}

test("migration defines versioned separate stores and uniqueness constraints", async () => {
  const sql = await readFile(new URL("../src/db/migrations/001_initial.sql", import.meta.url), "utf8");
  for (const table of ["agents", "agent_seeds", "agent_states", "agent_memories", "agent_episodes", "agent_narratives", "agent_evaluations", "audit_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE\s*\(agent_id, sequence\)/i);
  assert.match(sql, /event_id\s+TEXT\s+NOT NULL\s+UNIQUE/i);
  assert.match(sql, /public_key\s+TEXT\s+NOT NULL\s+UNIQUE/i);
});

test("enrollment is idempotent and aliases/public keys remain unique", async () => {
  const repository = new InMemoryAgentRepository();
  const first = await repository.enroll(agentInput());
  const again = await repository.enroll(agentInput());
  assert.equal(first.id, again.id);
  assert.equal((await repository.list()).length, 1);

  const otherKey = Keypair.random().publicKey();
  await assert.rejects(() => repository.enroll(agentInput("ALPHA", otherKey)), (error: unknown) =>
    error instanceof RepositoryConflict && error.code === "ALIAS_CONFLICT");
});

test("accepts strictly ordered events and duplicate payloads evolve only once", async () => {
  const repository = new InMemoryAgentRepository();
  const agent = await repository.enroll(agentInput());
  const first = await repository.applyEvolution(agent.id, event());
  const duplicate = await repository.applyEvolution(agent.id, event());
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await repository.get(agent.id))?.revision, 1);
});

test("rejects conflicting event IDs and skipped or late sequences", async () => {
  const repository = new InMemoryAgentRepository();
  const agent = await repository.enroll(agentInput());
  await repository.applyEvolution(agent.id, event());
  await assert.rejects(
    () => repository.applyEvolution(agent.id, { ...event(), context: { changed: true } }),
    (error: unknown) => error instanceof RepositoryConflict && error.code === "EVENT_ID_CONFLICT",
  );
  await assert.rejects(
    () => repository.applyEvolution(agent.id, event(3)),
    (error: unknown) => error instanceof RepositoryConflict && error.code === "SEQUENCE_CONFLICT",
  );
});

test("an event ID cannot be replayed against a different target", async () => {
  const repository = new InMemoryAgentRepository();
  const first = await repository.enroll(agentInput("ALPHA", publicKey));
  const secondKey = Keypair.random().publicKey();
  const second = await repository.enroll(agentInput("BETA", secondKey));
  await repository.applyEvolution(first.id, event());
  await assert.rejects(
    () => repository.applyEvolution(second.id, event()),
    (error: unknown) => error instanceof RepositoryConflict && error.code === "EVENT_ID_CONFLICT",
  );
});

test("an idle PostgreSQL pool error is contained and marks readiness unhealthy", async () => {
  const fakePool = new EventEmitter() as unknown as Pool;
  const repository = new PostgresAgentRepository(fakePool);
  assert.doesNotThrow(() => (fakePool as unknown as EventEmitter).emit("error", new Error("database restarted")));
  assert.equal((await repository.readiness()).database, false);
});

test("a failed evolution is atomic and does not revise state", async () => {
  const repository = new InMemoryAgentRepository({ failEvolution: true });
  const agent = await repository.enroll(agentInput());
  await assert.rejects(() => repository.applyEvolution(agent.id, event()), /injected evolution failure/);
  assert.equal((await repository.get(agent.id))?.revision, 0);
  assert.equal((await repository.metrics()).episodes, 0);
});

test("public projections omit seeds, memories, traces, and credentials", async () => {
  const repository = new InMemoryAgentRepository();
  const agent = await repository.enroll(agentInput());
  const serialized = JSON.stringify(await repository.get(agent.id));
  for (const forbidden of ["fingerprint", "identityMaster", "secret", "memories", "trace"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});
