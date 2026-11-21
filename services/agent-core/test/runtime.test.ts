import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../src/config.js";
import { InMemoryAgentRepository } from "../src/db/repository.js";
import { EnrollmentLoop } from "../src/runtime/evolution-loop.js";
import { startRuntime } from "../src/runtime/runtime.js";

const config: AppConfig = {
  databaseUrl: "memory",
  identityMasterKey: "runtime-master-key-".repeat(3),
  identityKeyVersion: 1,
  internalApiKey: "runtime-api-key-".repeat(3),
  agentEnvPrefix: "ORRYLO_AGENT_",
  executionEnabled: false,
  executionMaxTradeXlm: 0.1,
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

test("health listener starts before database initialization, while migration still precedes reconciliation", async () => {
  const order: string[] = [];
  class OrderedRepository extends InMemoryAgentRepository {
    override async migrate() { order.push("migrate"); await super.migrate(); }
    override async setEnrollmentStatus(codes: string[]) { order.push("reconcile"); await super.setEnrollmentStatus(codes); }
  }
  const repository = new OrderedRepository();
  const server = {
    listen: async () => { order.push("listen"); },
    close: async () => { order.push("server-close"); },
  };
  const runtime = await startRuntime({ config, repository, env: {}, server, logger: { info() {}, error() {} } });
  assert.deepEqual(order.slice(0, 3), ["listen", "migrate", "reconcile"]);
  await runtime.stop();
});

test("initial database failure leaves the process listener available for health checks", async () => {
  const events: string[] = [];
  class FailedMigrationRepository extends InMemoryAgentRepository {
    override async migrate() { events.push("migrate-failed"); throw new Error("database unavailable"); }
  }
  const runtime = await startRuntime({
    config,
    repository: new FailedMigrationRepository(),
    env: {},
    server: { listen: async () => { events.push("listen"); }, close: async () => {} },
    logger: { info() {}, error() { events.push("logged"); } },
  });
  assert.deepEqual(events.slice(0, 3), ["listen", "migrate-failed", "logged"]);
  await runtime.stop();
});

test("reconciliation loop never overlaps", async () => {
  let releases: (() => void) | undefined;
  let calls = 0;
  const loop = new EnrollmentLoop(30_000, async () => {
    calls += 1;
    await new Promise<void>((resolve) => { releases = resolve; });
  });
  const first = loop.tick();
  const second = await loop.tick();
  assert.equal(second, false);
  assert.equal(calls, 1);
  releases?.();
  assert.equal(await first, true);
});

test("graceful shutdown closes the server and repository once", async () => {
  const events: string[] = [];
  class ClosingRepository extends InMemoryAgentRepository {
    override async close() { events.push("repository-close"); }
  }
  const server = { listen: async () => {}, close: async () => { events.push("server-close"); } };
  const runtime = await startRuntime({ config, repository: new ClosingRepository(), env: {}, server, logger: { info() {}, error() {} } });
  await runtime.stop();
  await runtime.stop();
  assert.deepEqual(events, ["server-close", "repository-close"]);
});

test("runtime logs only sanitized enrollment counts", async () => {
  const secret = "SSECRET-DO-NOT-LOG";
  const logs: unknown[] = [];
  const runtime = await startRuntime({
    config,
    repository: new InMemoryAgentRepository(),
    env: { ORRYLO_AGENT_ALPHA_SECRET_KEY: secret },
    server: { listen: async () => {}, close: async () => {} },
    logger: { info(value: unknown) { logs.push(value); }, error(value: unknown) { logs.push(value); } },
  });
  await runtime.stop();
  assert.equal(JSON.stringify(logs).includes(secret), false);
});
