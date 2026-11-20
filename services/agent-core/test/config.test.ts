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
});

test("rejects missing required variables without echoing values", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, DATABASE_URL: undefined }),
    (error: unknown) => error instanceof ConfigError && error.code === "CONFIG_REQUIRED",
  );
});

test("rejects live execution in phase one", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, ORRYLO_EXECUTION_ENABLED: "true" }),
    (error: unknown) => error instanceof ConfigError && error.code === "EXECUTION_FORBIDDEN",
  );
});

test("validates port, version, intervals, and key lengths", () => {
  for (const env of [
    { ...validEnv, PORT: "0" },
    { ...validEnv, ORRYLO_IDENTITY_KEY_VERSION: "0" },
    { ...validEnv, ORRYLO_RECONCILE_INTERVAL_MS: "99" },
    { ...validEnv, ORRYLO_INTERNAL_API_KEY: "short" },
  ]) {
    assert.throws(() => loadConfig(env), ConfigError);
  }
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
