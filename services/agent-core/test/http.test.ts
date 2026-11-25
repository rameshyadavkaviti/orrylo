import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import type { AppConfig } from "../src/config.js";
import { InMemoryAgentRepository } from "../src/db/repository.js";
import { createInitialState } from "../src/evolution/evolve.js";
import { buildServer } from "../src/http/server.js";
import { deriveCognitiveSeed } from "../src/identity/derive-seed.js";

const config: AppConfig = {
  databaseUrl: "memory",
  identityMasterKey: "http-master-key-".repeat(3),
  identityKeyVersion: 1,
  internalApiKey: "current-api-key-".repeat(3),
  internalApiKeyPrevious: "previous-api-key-".repeat(3),
  agentEnvPrefix: "ORRYLO_AGENT_",
  executionEnabled: false,
  executionMaxTradeXlm: 0.1,
  executionMinOrderXlm: 0.01,
  executionDailyCapXlm: 0.5,
  executionMinFreeXlm: 2,
  executionMaxBuyPriceXlm: 0.1,
  executionMaxOpenOffers: 3,
  relatedPublicKeys: [],
  claimableObservationEnabled: false,
  claimExecutionEnabled: false,
  paused: false,
  port: 3000,
  host: "127.0.0.1",
  reconcileIntervalMs: 30_000,
  decisionEnabled: false,
  decisionIntervalMs: 300_000,
  horizonUrl: "https://horizon.stellar.org",
  ryloCode: "RYLO",
  ryloIssuer: "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO",
  referencePriceXlm: 0.1,
};

async function fixture(overrides: Partial<AppConfig> = {}) {
  const repository = new InMemoryAgentRepository();
  await repository.migrate();
  const wallet = Keypair.random();
  const seed = deriveCognitiveSeed(config.identityMasterKey, wallet.publicKey(), 1);
  const agent = await repository.enroll({ alias: "ALPHA", publicKey: wallet.publicKey(), seed, state: createInitialState(seed) });
  const server = buildServer({ config: { ...config, ...overrides }, repository, logger: false });
  return { repository, wallet, agent, server };
}

test("health and readiness are open and redacted", async (t) => {
  const { server } = await fixture();
  t.after(() => server.close());
  const health = await server.inject({ method: "GET", url: "/healthz" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { ok: true, service: "orrylo-agent-core" });
  const ready = await server.inject({ method: "GET", url: "/readyz" });
  assert.equal(ready.statusCode, 200);
  const serialized = ready.body.toLowerCase();
  assert.equal(serialized.includes("postgresql://"), false);
  assert.equal(serialized.includes("api-key"), false);
});

test("all v1 routes require current or previous bearer keys", async (t) => {
  const { server } = await fixture();
  t.after(() => server.close());
  assert.equal((await server.inject({ method: "GET", url: "/v1/agents" })).statusCode, 401);
  assert.equal((await server.inject({ method: "GET", url: "/v1/agents", headers: { authorization: `Bearer ${config.internalApiKey}` } })).statusCode, 200);
  assert.equal((await server.inject({ method: "GET", url: "/v1/metrics", headers: { authorization: `Bearer ${config.internalApiKeyPrevious}` } })).statusCode, 200);
});

test("does not treat an absent previous key fallback as a credential", async (t) => {
  const { server } = await fixture({ internalApiKeyPrevious: undefined });
  t.after(() => server.close());
  const response = await server.inject({ method: "GET", url: "/v1/agents", headers: { authorization: "Bearer __no_previous_key__" } });
  assert.equal(response.statusCode, 401);
});

test("protects private routes selected through URL normalization", async (t) => {
  const { server } = await fixture();
  t.after(() => server.close());
  const response = await server.inject({ method: "GET", url: "/%76%31/agents" });
  assert.equal(response.statusCode, 401);
});

test("lists agents and returns one redacted cognitive summary", async (t) => {
  const { server, agent } = await fixture();
  t.after(() => server.close());
  const headers = { authorization: `Bearer ${config.internalApiKey}` };
  const list = await server.inject({ method: "GET", url: "/v1/agents", headers });
  assert.equal(list.json().agents.length, 1);
  const detail = await server.inject({ method: "GET", url: `/v1/agents/${agent.id}`, headers });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().agent.id, agent.id);
  assert.equal(detail.body.includes("fingerprint"), false);
});

test("validates, orders, and idempotently ingests events", async (t) => {
  const { server, agent } = await fixture();
  t.after(() => server.close());
  const headers = { authorization: `Bearer ${config.internalApiKey}` };
  const payload = {
    eventId: "api-event-1",
    agentId: agent.id,
    type: "market_observation",
    sequence: 1,
    occurredAt: "2026-11-21T00:00:00.000Z",
    source: "integration-test",
    context: { contextTag: "market", scarcity: 0.7 },
  };
  const first = await server.inject({ method: "POST", url: "/v1/events", headers, payload });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().duplicate, false);
  const duplicate = await server.inject({ method: "POST", url: "/v1/events", headers, payload });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().duplicate, true);
  const conflict = await server.inject({ method: "POST", url: "/v1/events", headers, payload: { ...payload, context: { contextTag: "market", scarcity: 0.8 } } });
  assert.equal(conflict.statusCode, 409);
  const invalid = await server.inject({ method: "POST", url: "/v1/events", headers, payload: { ...payload, eventId: "x", agentId: undefined, publicKey: undefined } });
  assert.equal(invalid.statusCode, 400);
});

test("rejects unknown, credential-like, out-of-range, and non-ISO event fields", async () => {
  const invalidPayloads = [
    { context: { contextTag: "market", secretKey: "must-not-persist" } },
    { context: { scarcity: 2 } },
    { occurredAt: "2026-11-21" },
    { outcome: { apiKey: "must-not-persist" } },
  ];
  for (let index = 0; index < invalidPayloads.length; index += 1) {
    const { server, agent } = await fixture();
    const base = {
      eventId: `invalid-${index}`, agentId: agent.id, type: "market_observation", sequence: 1,
      occurredAt: "2026-11-21T00:00:00.000Z", source: "test", context: {},
    };
    const response = await server.inject({
      method: "POST", url: "/v1/events", headers: { authorization: `Bearer ${config.internalApiKey}` },
      payload: { ...base, ...invalidPayloads[index] },
    });
    assert.equal(response.statusCode, 400, `case ${index} was accepted`);
    await server.close();
  }
});

test("pause rejects ingestion without hiding operational endpoints", async (t) => {
  const { server, agent } = await fixture({ paused: true });
  t.after(() => server.close());
  assert.equal((await server.inject({ method: "GET", url: "/healthz" })).statusCode, 200);
  assert.equal((await server.inject({ method: "GET", url: "/readyz" })).statusCode, 503);
  const response = await server.inject({
    method: "POST", url: "/v1/events",
    headers: { authorization: `Bearer ${config.internalApiKey}` },
    payload: { eventId: "paused", agentId: agent.id, type: "evaluation_probe", sequence: 1, occurredAt: "2026-11-21T00:00:00.000Z", source: "test", context: {} },
  });
  assert.equal(response.statusCode, 503);
});

test("database failure makes readiness fail while health stays up", async (t) => {
  class FailedRepository extends InMemoryAgentRepository {
    override async readiness() { return { database: false, migrated: false, enrollmentHealthy: false, invalidCandidates: 0 }; }
  }
  const repository = new FailedRepository();
  const server = buildServer({ config, repository, logger: false });
  t.after(() => server.close());
  assert.equal((await server.inject({ method: "GET", url: "/healthz" })).statusCode, 200);
  assert.equal((await server.inject({ method: "GET", url: "/readyz" })).statusCode, 503);
});
