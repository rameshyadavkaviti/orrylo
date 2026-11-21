import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { evolveAgent, createInitialState } from "../src/evolution/evolve.js";
import type { AgentEvent, AgentMemory, AgentState } from "../src/evolution/types.js";
import { deriveCognitiveSeed } from "../src/identity/derive-seed.js";

const publicKey = Keypair.fromRawEd25519Seed(createHash("sha256").update("evolution-agent").digest()).publicKey();
const seed = deriveCognitiveSeed("evolution-test-master-key-".repeat(2), publicKey, 1);

function event(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    eventId: "evt-1",
    type: "market_observation",
    sequence: 1,
    occurredAt: "2026-11-21T00:00:00.000Z",
    source: "test",
    context: { contextTag: "rising-market", priceChange: 0.2, scarcity: 0.7, uncertainty: 0.4, stakes: 0.5 },
    ...overrides,
  };
}

test("deterministically replays the same episode and complete causal trace", () => {
  const state = createInitialState(seed);
  const first = evolveAgent(seed, state, [], event());
  const second = evolveAgent(seed, state, [], event());
  assert.deepEqual(first, second);
  assert.deepEqual(first.trace.stages, [
    "observation", "attention", "appraisal", "memory_retrieval", "active_goals", "fast_proposals",
    "deliberation_gate", "valuation", "inhibition_commitment", "action_tendency", "outcome_attribution",
    "memory_update", "self_model_update", "consolidation",
  ]);
});

test("caps state, learned-prior, and durable identity changes", () => {
  const state = createInitialState(seed);
  const evidence = Array.from({ length: 12 }, (_, index) => ({
    direction: 1 as const,
    contextTag: `context-${index % 3}`,
  }));
  state.identityEvidence = evidence;
  const result = evolveAgent(seed, state, [], event({
    type: "operator_feedback",
    context: { contextTag: "context-0", valence: 1, priceChange: 100, scarcity: 100, uncertainty: 1, stakes: 1 },
    outcome: { reward: 100 },
  }));
  for (const delta of Object.values(result.deltas.state)) assert.ok(Math.abs(delta) <= 0.15);
  for (const delta of Object.values(result.deltas.learnedPriors)) assert.ok(Math.abs(delta) <= 0.02);
  for (const delta of Object.values(result.deltas.identity)) assert.ok(Math.abs(delta) <= 0.005);
});

test("early learning is faster and decays with experience", () => {
  const early = createInitialState(seed);
  const mature = { ...createInitialState(seed), episodeCount: 100 };
  const earlyResult = evolveAgent(seed, early, [], event());
  const matureResult = evolveAgent(seed, mature, [], event());
  assert.ok(earlyResult.metrics.effectiveLearningRate > matureResult.metrics.effectiveLearningRate);
});

test("deliberation rises with uncertainty, conflict, stakes, and accountability", () => {
  const state = createInitialState(seed);
  const low = evolveAgent(seed, state, [], event({
    eventId: "low",
    context: { contextTag: "calm", uncertainty: 0, stakes: 0, goalConflict: 0, accountability: 0, timePressure: 0 },
  }));
  const high = evolveAgent(seed, state, [], event({
    eventId: "high",
    context: { contextTag: "stress", uncertainty: 1, stakes: 1, goalConflict: 1, accountability: 1, timePressure: 0 },
  }));
  assert.ok(high.trace.deliberationProbability > low.trace.deliberationProbability);
});

test("retrieves at most five memories using relevance, salience, recency, and identity", () => {
  const memories: AgentMemory[] = Array.from({ length: 8 }, (_, index) => ({
    id: `memory-${index}`,
    kind: "episodic",
    contextTag: index < 6 ? "rising-market" : "other",
    valence: index / 10,
    salience: index / 8,
    identityRelevance: index / 8,
    occurredAt: new Date(Date.UTC(2026, 10, 20, index)).toISOString(),
    payload: { index },
  }));
  const result = evolveAgent(seed, createInitialState(seed), memories, event());
  assert.equal(result.retrievedMemories.length, 5);
  assert.equal(result.retrievedMemories[0]?.id, "memory-7");
});

test("different histories produce different later state", () => {
  const initial = createInitialState(seed);
  const win = evolveAgent(seed, initial, [], event({ eventId: "win", outcome: { reward: 1 } }));
  const loss = evolveAgent(seed, initial, [], event({ eventId: "loss", outcome: { reward: -1 } }));
  const next = event({ eventId: "next", sequence: 2 });
  const afterWin = evolveAgent(seed, win.state, win.memories, next);
  const afterLoss = evolveAgent(seed, loss.state, loss.memories, next);
  assert.notDeepEqual(afterWin.state, afterLoss.state);
});

test("preserves every legitimate action and never guarantees BUY", () => {
  const result = evolveAgent(seed, createInitialState(seed), [], event({
    context: { contextTag: "scarce", scarcity: 1, rivalGain: 1, uncertainty: 0, stakes: 0.5 },
  }));
  assert.deepEqual(Object.keys(result.actionDistribution).sort(), ["abstain", "buy", "exit", "hold", "observe", "sell", "wait"]);
  assert.ok(result.actionDistribution.buy! < 1);
  assert.ok(result.actionDistribution.abstain! > 0);
  assert.ok(result.actionDistribution.sell! > 0);
});

test("learned priors and consolidated identity causally change later choices", () => {
  const baseline = createInitialState(seed);
  const learned = structuredClone(baseline);
  learned.learnedPriors.marketConfidence = 0.95;
  learned.learnedPriors.scarcityExpectation = 0.95;
  learned.learnedPriors.riskTolerance = 0.9;
  learned.identityAdjustments.achievement = 0.1;
  learned.identityAdjustments.prudence = -0.1;
  const observation = event({ eventId: "causal-priors", context: { contextTag: "market", scarcity: 0.7, uncertainty: 0.5 } });
  const first = evolveAgent(seed, baseline, [], observation);
  const second = evolveAgent(seed, learned, [], observation);
  assert.notDeepEqual(first.actionDistribution, second.actionDistribution);
});

test("the deliberation gate changes valuation rather than only recording a flag", () => {
  const state = createInitialState(seed);
  const context = { contextTag: "decision", uncertainty: 0.8, stakes: 0.9, goalConflict: 0.8, accountability: 0.8 };
  const results = Array.from({ length: 100 }, (_, index) => evolveAgent(seed, state, [], event({ eventId: `gate-${index}`, context })));
  const deliberated = results.find((result) => result.trace.deliberated);
  const automatic = results.find((result) => !result.trace.deliberated);
  assert.ok(deliberated && automatic, "fixture must exercise both gate branches");
  assert.notDeepEqual(deliberated.actionDistribution, automatic.actionDistribution);
});

test("ambiguity and goal conflict produce structured exploration and longer decisions", () => {
  const state = createInitialState(seed);
  const low = evolveAgent(seed, state, [], event({
    eventId: "natural-variability",
    context: { contextTag: "choice", uncertainty: 0.05, goalConflict: 0.05, stakes: 0.2, accountability: 0.2 },
  }));
  const high = evolveAgent(seed, state, [], event({
    eventId: "natural-variability",
    context: { contextTag: "choice", uncertainty: 0.95, goalConflict: 0.95, stakes: 0.8, accountability: 0.8 },
  }));
  assert.ok(high.trace.selectionTemperature > low.trace.selectionTemperature);
  assert.ok(high.metrics.behavioralEntropy > low.metrics.behavioralEntropy);
  assert.ok(high.trace.decisionLatencyMs > low.trace.decisionLatencyMs);
});

test("temporary state decays toward baseline while durable identity remains intact", () => {
  const stressed = createInitialState(seed);
  stressed.stress = 0.95;
  stressed.energy = 0.1;
  stressed.affect = -0.8;
  stressed.lastEpisodeAt = "2026-11-20T00:00:00.000Z";
  const immediate = evolveAgent(seed, { ...stressed, lastEpisodeAt: "2026-11-21T00:00:00.000Z" }, [], event({
    eventId: "immediate-state", occurredAt: "2026-11-21T00:00:00.000Z", context: { contextTag: "calm", uncertainty: 0 },
  }));
  const recovered = evolveAgent(seed, stressed, [], event({
    eventId: "recovered-state", occurredAt: "2026-11-21T00:00:00.000Z", context: { contextTag: "calm", uncertainty: 0 },
  }));
  assert.ok(recovered.state.stress < immediate.state.stress);
  assert.ok(recovered.state.energy > immediate.state.energy);
  assert.ok(recovered.state.affect > immediate.state.affect);
  assert.deepEqual(recovered.state.identityAdjustments, immediate.state.identityAdjustments);
});

test("outcome prediction errors build context habits and negative outcomes trigger recovery", () => {
  let state = createInitialState(seed);
  let memories: AgentMemory[] = [];
  for (let index = 1; index <= 8; index += 1) {
    const result = evolveAgent(seed, state, memories, event({
      eventId: `habit-win-${index}`,
      type: "decision_outcome",
      sequence: index,
      occurredAt: new Date(Date.UTC(2026, 10, 21, 0, index)).toISOString(),
      context: { contextTag: "scarce-market", uncertainty: 0.2 },
      outcome: { reward: 1, action: "buy" },
    }));
    state = result.state;
    memories = result.memories;
  }
  const strengthened = state.behavioralDynamics?.contextHabits["scarce-market"]?.buy ?? 0;
  assert.ok(strengthened > 0);
  const loss = evolveAgent(seed, state, memories, event({
    eventId: "habit-loss",
    type: "decision_outcome",
    sequence: 9,
    occurredAt: "2026-11-21T01:00:00.000Z",
    context: { contextTag: "scarce-market", uncertainty: 0.2 },
    outcome: { reward: -1, action: "buy" },
  }));
  assert.ok((loss.state.behavioralDynamics?.contextHabits["scarce-market"]?.buy ?? 0) < strengthened);
  assert.ok((loss.state.behavioralDynamics?.recoveryLoad ?? 0) > 0);
  assert.ok(loss.metrics.predictionError < 0);
  assert.equal(loss.memories.at(-1)?.kind, "procedural");
});

test("legacy persisted states are upgraded causally without resetting their history", () => {
  const legacy = createInitialState(seed) as AgentState;
  legacy.schemaVersion = 1;
  delete legacy.lastEpisodeAt;
  delete legacy.behavioralDynamics;
  delete legacy.referenceLearning;
  delete legacy.selfModel;
  legacy.episodeCount = 17;
  legacy.revision = 17;
  const result = evolveAgent(seed, legacy, [], event({ eventId: "legacy-upgrade", sequence: 18 }));
  assert.equal(result.state.schemaVersion, 2);
  assert.equal(result.state.episodeCount, 18);
  assert.ok(result.state.behavioralDynamics);
  assert.ok(result.state.referenceLearning);
  assert.ok(result.state.selfModel);
});

test("a RYLO gift is appraised through claim, defer, and decline rather than market actions", () => {
  const result = evolveAgent(seed, createInitialState(seed), [], event({
    eventId: "claimable-gift",
    type: "claimable_balance_observation",
    context: {
      contextTag: "rylo_claimable_gift",
      giftAmountRylo: 2,
      giftUnconditional: 1,
      hasRyloTrustline: 0,
      feeBurden: 0.000001,
      uncertainty: 0.05,
      stakes: 0.1,
      goalConflict: 0.05,
      accountability: 1,
      timePressure: 0,
      socialReliability: 0.7,
    },
  }));
  assert.deepEqual(Object.keys(result.actionDistribution).sort(), ["claim", "decline", "defer"]);
  assert.ok(result.actionDistribution.claim! > result.actionDistribution.decline!);
  assert.equal(result.trace.fastProposal, "claim");
});
