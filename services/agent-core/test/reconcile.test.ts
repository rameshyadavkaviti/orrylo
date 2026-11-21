import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import type { AppConfig } from "../src/config.js";
import { InMemoryAgentRepository } from "../src/db/repository.js";
import { reconcileEnrollment } from "../src/enrollment/reconcile.js";

const config: AppConfig = {
  databaseUrl: "memory",
  identityMasterKey: "reconcile-master-key-".repeat(3),
  identityKeyVersion: 1,
  internalApiKey: "api-key-".repeat(8),
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

function env(alias: string, wallet: Keypair): Record<string, string> {
  return {
    [`ORRYLO_AGENT_${alias}_PUBLIC_KEY`]: wallet.publicKey(),
    [`ORRYLO_AGENT_${alias}_SECRET_KEY`]: wallet.secret(),
  };
}

test("enrolls a valid wallet immediately and restart is idempotent", async () => {
  const wallet = Keypair.random();
  const repository = new InMemoryAgentRepository();
  await repository.migrate();
  const first = await reconcileEnrollment(env("ALPHA", wallet), config, repository);
  const second = await reconcileEnrollment(env("ALPHA", wallet), config, repository);
  assert.equal(first.enrolled, 1);
  assert.equal(second.enrolled, 0);
  assert.equal((await repository.list()).length, 1);
  assert.equal((await repository.get(wallet.publicKey()))?.revision, 0);
});

test("rename preserves identity and removal marks the durable agent unconfigured", async () => {
  const wallet = Keypair.random();
  const repository = new InMemoryAgentRepository();
  await repository.migrate();
  await reconcileEnrollment(env("ALPHA", wallet), config, repository);
  const before = await repository.get(wallet.publicKey());
  await reconcileEnrollment(env("BETA", wallet), config, repository);
  const renamed = await repository.get(wallet.publicKey());
  assert.equal(renamed?.id, before?.id);
  assert.equal(renamed?.alias, "BETA");
  await reconcileEnrollment({}, config, repository);
  assert.equal((await repository.get(wallet.publicKey()))?.configured, false);
});

test("mixed valid and invalid candidates enroll valid wallets but fail readiness", async () => {
  const valid = Keypair.random();
  const invalidSecret = Keypair.random();
  const repository = new InMemoryAgentRepository();
  await repository.migrate();
  const result = await reconcileEnrollment({
    ...env("VALID", valid),
    ORRYLO_AGENT_BROKEN_PUBLIC_KEY: valid.publicKey(),
    ORRYLO_AGENT_BROKEN_SECRET_KEY: invalidSecret.secret(),
  }, config, repository);
  assert.equal(result.configured, 1);
  assert.equal(result.invalid, 1);
  assert.equal((await repository.readiness()).enrollmentHealthy, false);
});

test("results and repository projections never contain secret material", async () => {
  const wallet = Keypair.random();
  const repository = new InMemoryAgentRepository();
  await repository.migrate();
  const result = await reconcileEnrollment(env("ALPHA", wallet), config, repository);
  assert.equal(JSON.stringify(result).includes(wallet.secret()), false);
  assert.equal(JSON.stringify(await repository.list()).includes(wallet.secret()), false);
});
