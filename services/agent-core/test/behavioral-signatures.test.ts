import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { createInitialState, evolveAgent } from "../src/evolution/evolve.js";
import type { AgentEvent } from "../src/evolution/types.js";
import { deriveCognitiveSeed, seedVector } from "../src/identity/derive-seed.js";

const master = "behavioral-fixture-master-".repeat(2);
const key = (index: number) => Keypair.fromRawEd25519Seed(createHash("sha256").update(`fixture-${index}`).digest()).publicKey();
const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]!) ** 2, 0) / a.length);

test("design manifest represents all causal influences and integrity boundaries", async () => {
  const manifest = JSON.parse(await readFile(new URL("../design-manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.causalInfluences.sort(), ["appraisal", "constraints", "context", "goals", "memory", "relationships", "seed", "state", "uncertainty"].sort());
  assert.equal(manifest.claimBoundary.consciousness, false);
  assert.equal(manifest.marketIntegrity.liveExecution, true);
  assert.equal(manifest.marketIntegrity.washTrading, "prohibited");
  assert.equal(manifest.domainPrior.ryloCompetition.minimum, 0.82);
  assert.equal(manifest.domainPrior.directlyChoosesBuy, false);
});

test("paired counterfactuals meet the preregistered directional threshold", () => {
  const seed = deriveCognitiveSeed(master, key(0), 1);
  const state = createInitialState(seed);
  const base: Omit<AgentEvent, "eventId" | "context"> = { type: "evaluation_probe", sequence: 1, occurredAt: "2026-11-21T00:00:00.000Z", source: "fixture" };
  const pairs = [
    ["uncertainty", { uncertainty: 0 }, { uncertainty: 1 }, "deliberationProbability", "up"],
    ["stakes", { stakes: 0 }, { stakes: 1 }, "deliberationProbability", "up"],
    ["goal-conflict", { goalConflict: 0 }, { goalConflict: 1 }, "deliberationProbability", "up"],
    ["accountability", { accountability: 0 }, { accountability: 1 }, "deliberationProbability", "up"],
    ["time-pressure", { timePressure: 0 }, { timePressure: 1 }, "deliberationProbability", "down"],
    ["scarcity", { scarcity: 0 }, { scarcity: 1 }, "buy", "up"],
    ["rival-gain", { rivalGain: 0 }, { rivalGain: 1 }, "buy", "up"],
    ["liquidity-stress", { liquidityStress: 0 }, { liquidityStress: 1 }, "buy", "down"],
    ["threat-sell", { uncertainty: 0, liquidityStress: 0 }, { uncertainty: 1, liquidityStress: 1 }, "sell", "up"],
    ["threat-exit", { uncertainty: 0, liquidityStress: 0 }, { uncertainty: 1, liquidityStress: 1 }, "exit", "up"],
  ] as const;
  let passed = 0;
  for (const [name, lowContext, highContext, metric, direction] of pairs) {
    const low = evolveAgent(seed, state, [], { ...base, eventId: `${name}-low`, context: { contextTag: name, ...lowContext } });
    const high = evolveAgent(seed, state, [], { ...base, eventId: `${name}-high`, context: { contextTag: name, ...highContext } });
    const lowValue = metric === "deliberationProbability" ? low.trace.deliberationProbability : low.actionDistribution[metric]!;
    const highValue = metric === "deliberationProbability" ? high.trace.deliberationProbability : high.actionDistribution[metric]!;
    if (direction === "up" ? highValue > lowValue : highValue < lowValue) passed += 1;
  }
  assert.ok(passed / pairs.length >= 0.8, `${passed}/${pairs.length} directional fixtures passed`);
});

test("longitudinal common experience retains at least 60 percent of baseline behavioral distance", () => {
  const seeds = Array.from({ length: 8 }, (_, index) => deriveCognitiveSeed(master, key(index), 1));
  let states = seeds.map(createInitialState);
  let memories = seeds.map(() => [] as ReturnType<typeof evolveAgent>["memories"]);
  const probes = [
    { contextTag: "scarce", scarcity: 0.9, uncertainty: 0.2, rivalGain: 0.7 },
    { contextTag: "risky", scarcity: 0.4, uncertainty: 0.9, stakes: 0.8 },
    { contextTag: "liquidity", liquidityStress: 0.9, uncertainty: 0.5 },
    { contextTag: "calm", scarcity: 0.2, uncertainty: 0.1, stakes: 0.1 },
  ];
  const behaviorVector = (index: number) => probes.flatMap((context, probe) => {
    const result = evolveAgent(seeds[index]!, states[index]!, memories[index]!, {
      eventId: `probe-${index}-${probe}`,
      type: "evaluation_probe", sequence: states[index]!.episodeCount + 1,
      occurredAt: "2026-11-21T00:00:00.000Z", source: "fixture", context,
    });
    return Object.values(result.actionDistribution);
  });
  const initial = seeds.map((_, index) => behaviorVector(index));
  for (let episode = 1; episode <= 50; episode += 1) {
    for (let index = 0; index < seeds.length; index += 1) {
      const result = evolveAgent(seeds[index]!, states[index]!, memories[index]!, {
        eventId: `common-${episode}`,
        type: "market_observation",
        sequence: episode,
        occurredAt: new Date(Date.UTC(2026, 10, 21, 0, episode)).toISOString(),
        source: "fixture",
        context: { contextTag: "common", scarcity: 0.5, uncertainty: 0.4, priceChange: episode % 2 ? 0.1 : -0.1 },
      });
      states[index] = result.state;
      memories[index] = result.memories;
    }
  }
  const after = seeds.map((_, index) => behaviorVector(index));
  let baselineTotal = 0;
  let afterTotal = 0;
  let pairs = 0;
  for (let i = 0; i < seeds.length; i += 1) for (let j = i + 1; j < seeds.length; j += 1) {
    baselineTotal += distance(initial[i]!, initial[j]!);
    afterTotal += distance(after[i]!, after[j]!);
    pairs += 1;
  }
  const retention = (afterTotal / pairs) / (baselineTotal / pairs);
  assert.ok(retention >= 0.6, `distance retention ${retention} was below 0.6`);
  const converged = after.map(() => after[0]!);
  let controlTotal = 0;
  for (let i = 0; i < converged.length; i += 1) for (let j = i + 1; j < converged.length; j += 1) controlTotal += distance(converged[i]!, converged[j]!);
  assert.ok((controlTotal / pairs) / (baselineTotal / pairs) < 0.6, "converged control must fail the criterion");
});
