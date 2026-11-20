import { createHash } from "node:crypto";

import type { CognitiveSeed, AvailableAction } from "../identity/types.js";
import type { AgentEvent, AgentMemory, AgentState, EvolutionResult } from "./types.js";

const stages = [
  "observation", "attention", "appraisal", "memory_retrieval", "active_goals", "fast_proposals",
  "deliberation_gate", "valuation", "inhibition_commitment", "action_tendency", "outcome_attribution",
  "memory_update", "self_model_update", "consolidation",
] as const;

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.min(maximum, Math.max(minimum, value));
const bounded = (value: number, cap: number): number => Math.min(cap, Math.max(-cap, value));
const round = (value: number): number => Number(value.toFixed(8));

function number(record: Record<string, unknown> | undefined, key: string, fallback = 0): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function contextTag(event: AgentEvent): string {
  const value = event.context.contextTag;
  return typeof value === "string" && value.length > 0 ? value.slice(0, 64) : event.type;
}

function draw(seed: CognitiveSeed, eventId: string): number {
  const bytes = createHash("sha256").update(`${seed.fingerprint}:${seed.keyVersion}:${eventId}`).digest();
  return bytes.readUIntBE(0, 6) / 0xffffffffffff;
}

export function createInitialState(seed: CognitiveSeed): AgentState {
  return {
    schemaVersion: 1,
    revision: 0,
    episodeCount: 0,
    affect: 0,
    arousal: 0.35,
    stress: 0.2,
    energy: 0.75,
    confidence: 0.5,
    urgency: 0.2,
    feltSecurity: clamp(1 - seed.inhibitors.solvencyConcern * 0.5),
    cognitiveLoad: 0.2,
    learnedPriors: {
      marketConfidence: 0.5,
      scarcityExpectation: 0.5,
      socialTrust: seed.socialPriors.baselineTrust,
      riskTolerance: clamp(1 - seed.inhibitors.uncertaintyAversion),
    },
    identityAdjustments: { achievement: 0, prudence: 0 },
    identityEvidence: [],
  };
}

function retrieveMemories(memories: AgentMemory[], event: AgentEvent): AgentMemory[] {
  const tag = contextTag(event);
  const timestamps = memories.map((memory) => Date.parse(memory.occurredAt)).filter(Number.isFinite);
  const minimum = timestamps.length ? Math.min(...timestamps) : 0;
  const maximum = timestamps.length ? Math.max(...timestamps) : 1;
  const span = Math.max(1, maximum - minimum);
  return memories
    .map((memory) => {
      const timestamp = Date.parse(memory.occurredAt);
      const recency = Number.isFinite(timestamp) ? (timestamp - minimum) / span : 0;
      const similarity = memory.contextTag === tag ? 1 : 0;
      const score = 0.35 * recency + 0.1 * similarity + 0.3 * memory.salience + 0.25 * memory.identityRelevance;
      return { memory, score };
    })
    .sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id))
    .slice(0, 5)
    .map(({ memory }) => memory);
}

function distribution(scores: Record<AvailableAction, number>): Record<AvailableAction, number> {
  const entries = Object.entries(scores) as [AvailableAction, number][];
  const exponents = entries.map(([action, score]) => [action, Math.exp(Math.min(8, Math.max(-8, score)))] as const);
  const total = exponents.reduce((sum, [, value]) => sum + value, 0);
  return Object.fromEntries(exponents.map(([action, value]) => [action, round(value / total)])) as Record<AvailableAction, number>;
}

function selectAction(probabilities: Record<AvailableAction, number>, random: number): AvailableAction {
  let cumulative = 0;
  for (const action of ["observe", "wait", "hold", "buy", "sell", "abstain", "exit"] as const) {
    cumulative += probabilities[action];
    if (random <= cumulative) return action;
  }
  return "abstain";
}

export function evolveAgent(seed: CognitiveSeed, current: AgentState, memories: AgentMemory[], event: AgentEvent): EvolutionResult {
  const random = draw(seed, event.eventId);
  const tag = contextTag(event);
  const priceChange = number(event.context, "priceChange");
  const scarcity = clamp(number(event.context, "scarcity"));
  const uncertainty = clamp(number(event.context, "uncertainty", 0.5));
  const stakes = clamp(number(event.context, "stakes", 0.5));
  const rivalGain = clamp(number(event.context, "rivalGain"));
  const goalConflict = clamp(number(event.context, "goalConflict"));
  const accountability = clamp(number(event.context, "accountability"));
  const timePressure = clamp(number(event.context, "timePressure"));
  const liquidityStress = clamp(number(event.context, "liquidityStress"));
  const explicitValence = clamp(number(event.context, "valence"), -1, 1);
  const reward = clamp(number(event.outcome, "reward"), -1, 1);
  const retrievedMemories = retrieveMemories(memories, event);
  const rememberedValence = retrievedMemories.length
    ? retrievedMemories.reduce((sum, memory) => sum + memory.valence, 0) / retrievedMemories.length
    : 0;

  const attention = clamp(
    0.15 + Math.abs(priceChange) * 0.35 + scarcity * seed.sensitivities.scarcity * 0.25
      + rivalGain * seed.sensitivities.relativeStatus * 0.25,
  );
  const opportunity = clamp(
    Math.max(0, priceChange) * 0.25 + scarcity * seed.motives.ryloAcquisitionDrive * 0.35
      + rivalGain * seed.motives.ryloCompetitionDrive * 0.25 + Math.max(0, rememberedValence) * 0.15,
  );
  const threat = clamp(
    Math.max(0, -priceChange) * seed.sensitivities.loss * 0.3
      + uncertainty * seed.inhibitors.uncertaintyAversion * 0.3
      + liquidityStress * seed.inhibitors.solvencyConcern * 0.3 + Math.max(0, -rememberedValence) * 0.1,
  );
  const surprise = clamp(Math.abs(priceChange) * 0.45 + Math.abs(explicitValence - rememberedValence) * 0.35 + uncertainty * 0.2);
  const deliberationProbability = clamp(
    0.05 + 0.22 * surprise + 0.2 * goalConflict + 0.2 * uncertainty + 0.18 * stakes + 0.15 * accountability
      - 0.15 * current.cognitiveLoad - 0.2 * timePressure - 0.12 * seed.cognition.deliberationThreshold,
  );
  const deliberated = random < deliberationProbability;
  const effectiveAchievement = clamp(seed.values.achievement + current.identityAdjustments.achievement);
  const effectivePrudence = clamp(seed.values.prudence + current.identityAdjustments.prudence);
  const effectiveLearningRate = seed.learning.baseRate * (1 + 2 * Math.exp(-current.episodeCount / 25));
  const experiencedValence = clamp(0.45 * reward + 0.25 * explicitValence + 0.2 * (opportunity - threat) + 0.1 * rememberedValence, -1, 1);

  const stateDelta = {
    affect: round(bounded(effectiveLearningRate * experiencedValence * 1.8, seed.plasticity.statePerEpisode)),
    arousal: round(bounded(effectiveLearningRate * (attention + surprise - current.arousal), seed.plasticity.statePerEpisode)),
    stress: round(bounded(effectiveLearningRate * (threat + uncertainty - opportunity * 0.35), seed.plasticity.statePerEpisode)),
    energy: round(bounded(-effectiveLearningRate * (0.3 * deliberationProbability + 0.2 * timePressure), seed.plasticity.statePerEpisode)),
    confidence: round(bounded(effectiveLearningRate * (experiencedValence - uncertainty * 0.25), seed.plasticity.statePerEpisode)),
    urgency: round(bounded(effectiveLearningRate * (scarcity + timePressure + rivalGain - 0.75), seed.plasticity.statePerEpisode)),
    feltSecurity: round(bounded(effectiveLearningRate * (experiencedValence - liquidityStress), seed.plasticity.statePerEpisode)),
    cognitiveLoad: round(bounded(effectiveLearningRate * (stakes + goalConflict + uncertainty - 0.8), seed.plasticity.statePerEpisode)),
  };
  const priorDelta = {
    marketConfidence: round(bounded(effectiveLearningRate * experiencedValence, seed.plasticity.learnedPriorPerEpisode)),
    scarcityExpectation: round(bounded(effectiveLearningRate * (scarcity - current.learnedPriors.scarcityExpectation), seed.plasticity.learnedPriorPerEpisode)),
    socialTrust: round(bounded(effectiveLearningRate * number(event.context, "socialReliability"), seed.plasticity.learnedPriorPerEpisode)),
    riskTolerance: round(bounded(effectiveLearningRate * (reward - uncertainty * seed.learning.negativeOutcomeWeight), seed.plasticity.learnedPriorPerEpisode)),
  };

  const newEvidence = [...current.identityEvidence];
  if (Math.abs(experiencedValence) >= 0.25) {
    newEvidence.push({ direction: experiencedValence >= 0 ? 1 : -1, contextTag: tag });
  }
  const recentEvidence = newEvidence.slice(-24);
  const positive = recentEvidence.filter((item) => item.direction === 1).length;
  const negative = recentEvidence.length - positive;
  const direction = positive === recentEvidence.length ? 1 : negative === recentEvidence.length ? -1 : 0;
  const contexts = new Set(recentEvidence.map((item) => item.contextTag)).size;
  const canConsolidate = recentEvidence.length >= seed.plasticity.identityEvidenceEpisodes
    && contexts >= seed.plasticity.identityEvidenceContexts && direction !== 0;
  const identityDelta = {
    achievement: canConsolidate ? round(bounded(direction * 0.005, seed.plasticity.identityPerConsolidation)) : 0,
    prudence: canConsolidate ? round(bounded(-direction * 0.0025, seed.plasticity.identityPerConsolidation)) : 0,
  };

  const actionDistribution = distribution({
    observe: 0.7 + uncertainty + seed.cognition.attentionBreadth * 0.4 + (deliberated ? 0.2 : 0),
    wait: 0.6 + uncertainty * 0.8 + seed.inhibitors.opportunityCostConcern * 0.4 + (deliberated ? 0.12 : 0),
    hold: 0.7 + seed.referencePoints.ownershipAttachment * 0.6 + current.confidence * 0.2 + effectivePrudence * 0.15,
    buy: 0.2 + opportunity * 1.4 + seed.motives.ryloAcquisitionDrive * 0.8
      + current.learnedPriors.marketConfidence * 0.25 + current.learnedPriors.scarcityExpectation * scarcity * 0.25
      + current.learnedPriors.riskTolerance * (1 - uncertainty) * 0.25 + effectiveAchievement * 0.18
      - threat * 1.1 - seed.inhibitors.solvencyConcern * liquidityStress
      - (deliberated ? uncertainty * 0.35 + effectivePrudence * 0.15 : 0),
    sell: 0.2 + threat * 1.1 + liquidityStress * 0.8 - seed.referencePoints.ownershipAttachment * 0.3
      + effectivePrudence * threat * 0.15 - current.learnedPriors.marketConfidence * 0.1,
    abstain: 0.35 + uncertainty * 0.7 + goalConflict * 0.4,
    exit: 0.1 + threat * 0.8 + liquidityStress * 0.9,
  });
  const actionTendency = selectAction(actionDistribution, random);

  const nextState: AgentState = {
    ...current,
    revision: current.revision + 1,
    episodeCount: current.episodeCount + 1,
    affect: clamp(current.affect + stateDelta.affect, -1, 1),
    arousal: clamp(current.arousal + stateDelta.arousal),
    stress: clamp(current.stress + stateDelta.stress),
    energy: clamp(current.energy + stateDelta.energy),
    confidence: clamp(current.confidence + stateDelta.confidence),
    urgency: clamp(current.urgency + stateDelta.urgency),
    feltSecurity: clamp(current.feltSecurity + stateDelta.feltSecurity),
    cognitiveLoad: clamp(current.cognitiveLoad + stateDelta.cognitiveLoad),
    learnedPriors: {
      marketConfidence: clamp(current.learnedPriors.marketConfidence + priorDelta.marketConfidence),
      scarcityExpectation: clamp(current.learnedPriors.scarcityExpectation + priorDelta.scarcityExpectation),
      socialTrust: clamp(current.learnedPriors.socialTrust + priorDelta.socialTrust),
      riskTolerance: clamp(current.learnedPriors.riskTolerance + priorDelta.riskTolerance),
    },
    identityAdjustments: {
      achievement: clamp(current.identityAdjustments.achievement + identityDelta.achievement, -0.15, 0.15),
      prudence: clamp(current.identityAdjustments.prudence + identityDelta.prudence, -0.15, 0.15),
    },
    identityEvidence: canConsolidate ? [] : recentEvidence,
  };

  const memory: AgentMemory = {
    id: `episode:${event.eventId}`,
    kind: "episodic",
    contextTag: tag,
    valence: round(experiencedValence),
    salience: round(clamp(0.35 * attention + 0.35 * surprise + 0.3 * stakes)),
    identityRelevance: round(clamp(goalConflict * 0.35 + accountability * 0.25 + Math.abs(experiencedValence) * 0.4)),
    occurredAt: event.occurredAt,
    payload: { eventType: event.type, actionTendency, appraisal: { opportunity, threat, surprise } },
  };

  return {
    state: nextState,
    memories: [...memories, memory],
    retrievedMemories,
    trace: {
      stages,
      deterministicDraw: round(random),
      attention: round(attention),
      appraisal: { opportunity: round(opportunity), threat: round(threat), surprise: round(surprise) },
      activeGoals: ["acquire_rylo_when_justified", "preserve_solvency", "maintain_identity_continuity"],
      fastProposal: opportunity > threat ? "buy" : threat > 0.7 ? "sell" : "observe",
      deliberationProbability: round(deliberationProbability),
      deliberated,
      attribution: {
        internal: round(clamp(0.35 + Math.abs(reward) * seed.cognition.counterfactualDepth * 0.35)),
        external: round(clamp(0.35 + surprise * 0.4)),
        uncertainty: round(uncertainty),
      },
    },
    actionDistribution,
    actionTendency,
    deltas: { state: stateDelta, learnedPriors: priorDelta, identity: identityDelta },
    metrics: { effectiveLearningRate: round(effectiveLearningRate), memoryCount: memories.length + 1 },
  };
}
