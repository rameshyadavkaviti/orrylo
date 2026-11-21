import assert from "node:assert/strict";
import test from "node:test";

import { ConfigError, loadConfig } from "../src/config.js";

const validEnv = {
  DATABASE_URL: "postgresql://user:secret@localhost:5432/agents",
  ORRYLO_IDENTITY_MASTER_KEY: "a".repeat(64),
  ORRYLO_INTERNAL_API_KEY: "b".repeat(48),
  ORRYLO_IDENTITY_KEY_VERSION: "1",
  ORRYLO_EXECUTION_ENABLED: "false",
};

test("loads safe defaults and explicit required settings", () => {
  const config = loadConfig(validEnv);
  assert.equal(config.port, 3000);
  assert.equal(config.paused, false);
  assert.equal(config.executionEnabled, false);
  assert.equal(config.agentEnvPrefix, "ORRYLO_AGENT_");
  assert.equal(config.identityKeyVersion, 1);
  assert.equal(config.decisionEnabled, false);
  assert.equal(config.decisionIntervalMs, 300_000);
  assert.equal(config.ryloCode, "RYLO");
  assert.equal(config.claimableObservationEnabled, false);
  assert.equal(config.claimExecutionEnabled, false);
});

test("rejects missing required variables without echoing values", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, DATABASE_URL: undefined }),
    (error: unknown) => error instanceof ConfigError && error.code === "CONFIG_REQUIRED",
  );
});

test("requires explicit risk and related-wallet controls for live market execution", () => {
  assert.throws(() => loadConfig({ ...validEnv, ORRYLO_EXECUTION_ENABLED: "true" }), ConfigError);
  const config = loadConfig({
    ...validEnv,
    ORRYLO_EXECUTION_ENABLED: "true",
    ORRYLO_EXECUTION_MAX_TRADE_XLM: "0.1",
    ORRYLO_EXECUTION_DAILY_CAP_XLM: "0.5",
    ORRYLO_EXECUTION_MIN_FREE_XLM: "2",
    ORRYLO_EXECUTION_MAX_BUY_PRICE_XLM: "0.1",
    ORRYLO_RELATED_PUBLIC_KEYS: "GCZCQZBSMZJTMTIHBDIAQM6BQMZ4P5QVPQ7UGNF5YKLPPEXD7EVEPBCH",
  });
  assert.equal(config.executionEnabled, true);
  assert.equal(config.executionMaxTradeXlm, 0.1);
  assert.equal(config.executionDailyCapXlm, 0.5);
});

test("validates port, version, intervals, and key lengths", () => {
  for (const env of [
    { ...validEnv, PORT: "0" },
    { ...validEnv, ORRYLO_IDENTITY_KEY_VERSION: "0" },
    { ...validEnv, ORRYLO_RECONCILE_INTERVAL_MS: "99" },
    { ...validEnv, ORRYLO_DECISION_INTERVAL_MS: "999" },
    { ...validEnv, ORRYLO_REFERENCE_PRICE_XLM: "0" },
    { ...validEnv, ORRYLO_RYLO_ISSUER: "not-a-public-key" },
    { ...validEnv, ORRYLO_INTERNAL_API_KEY: "short" },
  ]) {
    assert.throws(() => loadConfig(env), ConfigError);
  }
});

test("loads an explicitly enabled decision loop and verified market settings", () => {
  const config = loadConfig({
    ...validEnv,
    ORRYLO_DECISION_ENABLED: "true",
    ORRYLO_DECISION_INTERVAL_MS: "60000",
    ORRYLO_HORIZON_URL: "https://horizon.stellar.org/",
    ORRYLO_RYLO_ISSUER: "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO",
    ORRYLO_REFERENCE_PRICE_XLM: "0.1",
  });
  assert.equal(config.decisionEnabled, true);
  assert.equal(config.decisionIntervalMs, 60_000);
  assert.equal(config.horizonUrl, "https://horizon.stellar.org");
  assert.equal(config.referencePriceXlm, 0.1);
});

test("enables only the asset-scoped claim path without enabling market execution", () => {
  assert.throws(() => loadConfig({
    ...validEnv,
    ORRYLO_CLAIM_EXECUTION_ENABLED: "true",
  }), ConfigError);
  const config = loadConfig({
    ...validEnv,
    ORRYLO_CLAIMABLE_OBSERVATION_ENABLED: "true",
    ORRYLO_CLAIM_EXECUTION_ENABLED: "true",
  });
  assert.equal(config.claimableObservationEnabled, true);
  assert.equal(config.claimExecutionEnabled, true);
  assert.equal(config.executionEnabled, false);
});

test("supports pause and previous API key rotation", () => {
  const config = loadConfig({
    ...validEnv,
    ORRYLO_PAUSED: "true",
    ORRYLO_INTERNAL_API_KEY_PREVIOUS: "c".repeat(48),
  });
  assert.equal(config.paused, true);
  assert.equal(config.internalApiKeyPrevious, "c".repeat(48));
});

test("serialized errors never contain secret environment values", () => {
  const secret = "super-sensitive-wallet-or-api-secret";
  try {
    loadConfig({ ...validEnv, ORRYLO_INTERNAL_API_KEY: secret });
    assert.fail("expected loadConfig to reject a short key");
  } catch (error) {
    assert.equal(JSON.stringify(error).includes(secret), false);
    assert.equal(String(error).includes(secret), false);
  }
});
