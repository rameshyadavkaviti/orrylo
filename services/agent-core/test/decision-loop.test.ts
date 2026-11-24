import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { InMemoryAgentRepository } from "../src/db/repository.js";
import { createInitialState } from "../src/evolution/evolve.js";
import { deriveCognitiveSeed } from "../src/identity/derive-seed.js";
import { DecisionRunner, marketContextFromOrderBook } from "../src/runtime/decision-loop.js";

test("maps a sparse one-sided RYLO book to bounded uncertain context", () => {
  const context = marketContextFromOrderBook({ bids: [], asks: [{ price: "0.1000000", amount: "5000.0000000" }] }, 0.1);
  assert.equal(context.contextTag, "rylo_xlm_market");
  for (const key of ["scarcity", "uncertainty", "stakes", "goalConflict", "accountability", "liquidityStress"] as const) {
    assert.equal(typeof context[key], "number");
    assert.ok(context[key] >= 0 && context[key] <= 1);
  }
  assert.ok(context.uncertainty >= 0.75);
  assert.equal(context.rivalGain, 0);
});

test("one market observation creates one independent decision episode per configured agent", async () => {
  const repository = new InMemoryAgentRepository();
  await repository.migrate();
  for (const alias of ["A", "B"]) {
    const publicKey = Keypair.random().publicKey();
    const seed = deriveCognitiveSeed("master-key-material-that-is-long-enough", publicKey, 1);
    await repository.enroll({ alias, publicKey, seed, state: createInitialState(seed) });
  }
  const logs: unknown[] = [];
  const runner = new DecisionRunner({
    repository,
    observe: async () => ({
      observedAt: "2026-11-21T12:00:00.000Z",
      context: marketContextFromOrderBook({ bids: [], asks: [{ price: "0.1", amount: "5000" }] }, 0.1),
    }),
    logger: { info(value: unknown) { logs.push(value); }, error(value: unknown) { logs.push(value); } },
  });
  const result = await runner.run();
  assert.equal(result.decided, 2);
  assert.equal((await repository.metrics()).episodes, 2);
  assert.equal(JSON.stringify(logs).includes("S"), false);
});

test("failed offer maintenance never stops independent cognitive decisions", async () => {
  const repository = new InMemoryAgentRepository();
  await repository.migrate();
  const publicKey = Keypair.random().publicKey();
  const seed = deriveCognitiveSeed("master-key-material-that-is-long-enough", publicKey, 1);
  await repository.enroll({ alias: "TEST", publicKey, seed, state: createInitialState(seed) });
  const errorCodes: string[] = [];
  const runner = new DecisionRunner({
    repository,
    observe: async () => ({ observedAt: "2026-11-24T12:00:00Z",
      context: marketContextFromOrderBook({ bids: [], asks: [{ price: "0.1", amount: "5000" }] }, 0.1) }),
    logger: { info() {}, error(value: unknown) { errorCodes.push(String((value as {event?:string}).event)); } },
    executionEnabled: true,
    signerForPublicKey: () => Keypair.random(),
    maintainOffers: async () => { throw new Error("Horizon temporarily unavailable"); },
  });
  const result = await runner.run();
  assert.equal(result.decided, 1);
  assert.equal(result.failed, 0);
  assert.equal((await repository.metrics()).episodes, 1);
  assert.ok(errorCodes.includes("offer_cleanup_failed"));
});
