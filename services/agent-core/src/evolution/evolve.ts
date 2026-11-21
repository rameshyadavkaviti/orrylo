import { createHash } from "node:crypto";

import { availableActions, type CognitiveSeed, type AvailableAction } from "../identity/types.js";
import type { AgentEvent, AgentMemory, AgentState, EvolutionResult } from "./types.js";

const stages = [
  "observation", "attention", "appraisal", "memory_retrieval", "active_goals", "fast_proposals",
  "deliberation_gate", "valuation", "inhibition_commitment", "action_tendency", "outcome_attribution",
  "memory_update", "self_model_update", "consolidation",
] as const;

type BehavioralDynamics = NonNullable<AgentState["behavioralDynamics"]>;
type ReferenceLearning = NonNullable<AgentState["referenceLearning"]>;
type SelfModel = NonNullable<AgentState["selfModel"]>;
type NormalizedState = AgentState & {
  schemaVersion: 2;
  behavioralDynamics: BehavioralDynamics;
  referenceLearning: ReferenceLearning;
  selfModel: SelfModel;
};

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.min(maximum, Math.max(minimum, value));
const bounded = (value: number, cap: number): number => Math.min(cap, Math.max(-cap, value));
const round = (value: number): number => Number(value.toFixed(8));

function number(record: Record<string, unknown> | undefined, key: string, fallback = 0): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function contextTag(event: AgentEvent): string {
  const value = event.context.contextTag;
  return typeof value === "string" && value.length > 0 ? value.slice(0, 64) : event.type;
}

function draw(seed: CognitiveSeed, eventId: string, channel = "choice"): number {
  const bytes = createHash("sha256").update(`${seed.fingerprint}:${seed.keyVersion}:${eventId}:${channel}`).digest();
  return bytes.readUIntBE(0, 6) / 0xffffffffffff;
}

function action(value: unknown): AvailableAction | undefined {
  return typeof value === "string" && (availableActions as readonly string[]).includes(value)
    ? value as AvailableAction
    : undefined;
}

function decayToward(value: number, baseline: number, elapsedHours: number, halfLifeHours: number): number {
  if (elapsedHours <= 0) return value;
  const retained = Math.exp(-Math.LN2 * elapsedHours / halfLifeHours);
  return baseline + (value - baseline) * retained;
}

function normalizedState(seed: CognitiveSeed, current: AgentState, occurredAt: string): NormalizedState {
  const timestamp = Date.parse(occurredAt);
  const previousTimestamp = current.lastEpisodeAt ? Date.parse(current.lastEpisodeAt) : Number.NaN;
  const elapsedHours = Number.isFinite(timestamp) && Number.isFinite(previousTimestamp)
    ? clamp((timestamp - previousTimestamp) / 3_600_000, 0, 24 * 30)
    : 0;
  const baselineSecurity = clamp(1 - seed.inhibitors.solvencyConcern * 0.5);
  const dynamics: BehavioralDynamics = {
    recentAction: current.behavioralDynamics?.recentAction ?? null,
    actionRunLength: Math.max(0, Math.min(20, current.behavioralDynamics?.actionRunLength ?? 0)),
    recentOutcomeValence: decayToward(current.behavioralDynamics?.recentOutcomeValence ?? 0, 0, elapsedHours, 18),
    recoveryLoad: clamp(decayToward(current.behavioralDynamics?.recoveryLoad ?? 0, 0, elapsedHours, 12)),
    postErrorChecking: clamp(decayToward(current.behavioralDynamics?.postErrorChecking ?? 0, 0, elapsedHours, 8)),
    contextHabits: structuredClone(current.behavioralDynamics?.contextHabits ?? {}),
  };
  return {
    ...current,
    schemaVersion: 2,
    affect: clamp(decayToward(current.affect, 0, elapsedHours, 24), -1, 1),
    arousal: clamp(decayToward(current.arousal, 0.35, elapsedHours, 6)),
    stress: clamp(decayToward(current.stress, 0.2, elapsedHours, 18)),
    energy: clamp(decayToward(current.energy, 0.75, elapsedHours, 8)),
    confidence: clamp(decayToward(current.confidence, 0.5, elapsedHours, 72)),
    urgency: clamp(decayToward(current.urgency, 0.2, elapsedHours, 4)),
    feltSecurity: clamp(decayToward(current.feltSecurity, baselineSecurity, elapsedHours, 48)),
    cognitiveLoad: clamp(decayToward(current.cognitiveLoad, 0.2, elapsedHours, 6)),
    behavioralDynamics: dynamics,
    referenceLearning: {
      priceAnchorXlm: Math.max(0.0000001, current.referenceLearning?.priceAnchorXlm ?? 0.1),
      expectedReward: clamp(current.referenceLearning?.expectedReward ?? 0, -1, 1),
    },
    selfModel: {
      competence: clamp(current.selfModel?.competence ?? 0.5),
      agency: clamp(current.selfModel?.agency ?? 0.5),
      prudence: clamp(current.selfModel?.prudence ?? seed.values.prudence),
      consolidations: Math.max(0, Math.floor(current.selfModel?.consolidations ?? 0)),
    },
  };
}

export function createInitialState(seed: CognitiveSeed): AgentState {
  return {
    schemaVersion: 2,
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
    behavioralDynamics: {
      recentAction: null,
      actionRunLength: 0,
      recentOutcomeValence: 0,
      recoveryLoad: 0,
      postErrorChecking: 0,
      contextHabits: {},
    },
    referenceLearning: { priceAnchorXlm: 0.1, expectedReward: 0 },
    selfModel: { competence: 0.5, agency: 0.5, prudence: seed.values.prudence, consolidations: 0 },
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
      const proceduralMatch = event.type === "decision_outcome" && memory.kind === "procedural" ? 0.12 : 0;
      const score = 0.3 * recency + 0.13 * similarity + 0.28 * memory.salience
        + 0.25 * memory.identityRelevance + proceduralMatch;
      return { memory, score };
    })
    .sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id))
    .slice(0, 5)
    .map(({ memory }) => memory);
}

function distribution(scores: Record<AvailableAction, number>, temperature: number): Record<AvailableAction, number> {
  const entries = Object.entries(scores) as [AvailableAction, number][];
  const safeTemperature = clamp(temperature, 0.45, 1.6);
  const exponents = entries.map(([candidate, score]) => [candidate, Math.exp(Math.min(8, Math.max(-8, score / safeTemperature)))] as const);
  const total = exponents.reduce((sum, [, value]) => sum + value, 0);
  return Object.fromEntries(exponents.map(([candidate, value]) => [candidate, round(value / total)])) as Record<AvailableAction, number>;
}

function entropy(probabilities: Record<AvailableAction, number>): number {
  const raw = Object.values(probabilities).reduce((sum, probability) =>
    probability > 0 ? sum - probability * Math.log(probability) : sum, 0);
  return round(raw / Math.log(availableActions.length));
}

function selectAction(probabilities: Record<AvailableAction, number>, random: number): AvailableAction {
  let cumulative = 0;
  for (const candidate of availableActions) {
    cumulative += probabilities[candidate];
    if (random <= cumulative) return candidate;
  }
  return "abstain";
}

function memoryKind(event: AgentEvent, consolidated: boolean, outcomeAction?: AvailableAction): AgentMemory["kind"] {
  if (consolidated) return "narrative";
  if (event.type === "decision_outcome" && outcomeAction) return "procedural";
  if (event.type === "social_signal") return "social";
  if (event.type === "operator_feedback") return "semantic";
  return "episodic";
}

export function evolveAgent(seed: CognitiveSeed, currentInput: AgentState, memories: AgentMemory[], event: AgentEvent): EvolutionResult {
  const current = normalizedState(seed, currentInput, event.occurredAt);
  const random = draw(seed, event.eventId);
  const latencyDraw = draw(seed, event.eventId, "latency");
  const tag = contextTag(event);
  const priceChange = clamp(number(event.context, "priceChange"), -1, 1);
  const scarcity = clamp(number(event.context, "scarcity"));
  const uncertainty = clamp(number(event.context, "uncertainty", 0.5));
  const stakes = clamp(number(event.context, "stakes", 0.5));
  const rivalGain = clamp(number(event.context, "rivalGain"));
  const goalConflict = clamp(number(event.context, "goalConflict"));
  const accountability = clamp(number(event.context, "accountability"));
  const timePressure = clamp(number(event.context, "timePressure"));
  const liquidityStress = clamp(number(event.context, "liquidityStress"));
  const explicitValence = clamp(number(event.context, "valence"), -1, 1);
  const outcomeReward = optionalNumber(event.outcome, "reward");
  const reward = clamp(outcomeReward ?? 0, -1, 1);
  const outcomeAction = action(event.outcome?.action) ?? (event.type === "decision_outcome" ? current.behavioralDynamics.recentAction ?? undefined : undefined);
  const retrievedMemories = retrieveMemories(memories, event);
  const rememberedValence = retrievedMemories.length
    ? retrievedMemories.reduce((sum, memory) => sum + memory.valence, 0) / retrievedMemories.length
    : 0;

  const attention = clamp(
    0.15 + Math.abs(priceChange) * 0.35 + scarcity * seed.sensitivities.scarcity * 0.25
      + rivalGain * seed.sensitivities.relativeStatus * 0.25 + current.behavioralDynamics.postErrorChecking * 0.2,
  );
  const opportunity = clamp(
    Math.max(0, priceChange) * 0.25 + scarcity * seed.motives.ryloAcquisitionDrive * 0.35
      + rivalGain * seed.motives.ryloCompetitionDrive * 0.25 + Math.max(0, rememberedValence) * 0.15,
  );
  const threat = clamp(
    Math.max(0, -priceChange) * seed.sensitivities.loss * 0.3
      + uncertainty * seed.inhibitors.uncertaintyAversion * 0.3
      + liquidityStress * seed.inhibitors.solvencyConcern * 0.3 + Math.max(0, -rememberedValence) * 0.1
      + current.behavioralDynamics.recoveryLoad * 0.15,
  );
  const surprise = clamp(Math.abs(priceChange) * 0.45 + Math.abs(explicitValence - rememberedValence) * 0.35 + uncertainty * 0.2);
  const deliberationProbability = clamp(
    0.05 + 0.22 * surprise + 0.2 * goalConflict + 0.2 * uncertainty + 0.18 * stakes + 0.15 * accountability
      + 0.2 * current.behavioralDynamics.postErrorChecking - 0.15 * current.cognitiveLoad
      - 0.2 * timePressure - 0.12 * seed.cognition.deliberationThreshold,
  );
  const deliberated = random < deliberationProbability;
  const effectiveAchievement = clamp(seed.values.achievement + current.identityAdjustments.achievement);
  const effectivePrudence = clamp(seed.values.prudence + current.identityAdjustments.prudence);
  const effectiveLearningRate = seed.learning.baseRate * (1 + 2 * Math.exp(-current.episodeCount / 25));
  const predictionError = outcomeReward === undefined ? 0 : clamp(reward - current.referenceLearning.expectedReward, -2, 2);
  const weightedPredictionError = predictionError < 0
    ? predictionError * (1 + seed.learning.negativeOutcomeWeight)
    : predictionError;
  const experiencedValence = clamp(
    (outcomeReward === undefined ? 0 : 0.45 * reward) + 0.25 * explicitValence
      + 0.2 * (opportunity - threat) + 0.1 * rememberedValence,
    -1,
    1,
  );

  const stateDelta = {
    affect: round(bounded(effectiveLearningRate * experiencedValence * 1.8, seed.plasticity.statePerEpisode)),
    arousal: round(bounded(effectiveLearningRate * (attention + surprise - current.arousal), seed.plasticity.statePerEpisode)),
    stress: round(bounded(effectiveLearningRate * (threat + uncertainty + current.behavioralDynamics.recoveryLoad - opportunity * 0.35), seed.plasticity.statePerEpisode)),
    energy: round(bounded(-effectiveLearningRate * (0.3 * deliberationProbability + 0.2 * timePressure), seed.plasticity.statePerEpisode)),
    confidence: round(bounded(effectiveLearningRate * (experiencedValence + predictionError * 0.2 - uncertainty * 0.25), seed.plasticity.statePerEpisode)),
    urgency: round(bounded(effectiveLearningRate * (scarcity + timePressure + rivalGain - 0.75), seed.plasticity.statePerEpisode)),
    feltSecurity: round(bounded(effectiveLearningRate * (experiencedValence - liquidityStress), seed.plasticity.statePerEpisode)),
    cognitiveLoad: round(bounded(effectiveLearningRate * (stakes + goalConflict + uncertainty - 0.8), seed.plasticity.statePerEpisode)),
  };
  const learningSignal = outcomeReward === undefined ? experiencedValence * 0.25 : weightedPredictionError;
  const priorDelta = {
    marketConfidence: round(bounded(effectiveLearningRate * learningSignal, seed.plasticity.learnedPriorPerEpisode)),
    scarcityExpectation: round(bounded(effectiveLearningRate * (scarcity - current.learnedPriors.scarcityExpectation), seed.plasticity.learnedPriorPerEpisode)),
    socialTrust: round(bounded(effectiveLearningRate * number(event.context, "socialReliability"), seed.plasticity.learnedPriorPerEpisode)),
    riskTolerance: round(bounded(effectiveLearningRate * (learningSignal - uncertainty * seed.learning.negativeOutcomeWeight * 0.2), seed.plasticity.learnedPriorPerEpisode)),
  };

  const newEvidence = [...current.identityEvidence];
  if (Math.abs(experiencedValence) >= 0.25) newEvidence.push({ direction: experiencedValence >= 0 ? 1 : -1, contextTag: tag });
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

  const habits = current.behavioralDynamics.contextHabits[tag] ?? {};
  const maximumHabit = Math.max(0, ...availableActions.map((candidate) => clamp(habits[candidate] ?? 0)));
  const selectionTemperature = clamp(
    0.62 + seed.cognition.explorationTendency * 0.32 + uncertainty * 0.38 + goalConflict * 0.3
      + current.behavioralDynamics.recoveryLoad * 0.12 - current.confidence * 0.18 - maximumHabit * 0.22,
    0.45,
    1.6,
  );
  const currentPrice = optionalNumber(event.context, "marketPriceXlm") ?? optionalNumber(event.context, "bestAskXlm");
  const anchorGap = currentPrice && currentPrice > 0
    ? clamp((current.referenceLearning.priceAnchorXlm - currentPrice) / current.referenceLearning.priceAnchorXlm, -1, 1)
    : 0;
  const inertia = (candidate: AvailableAction): number => {
    if (current.behavioralDynamics.recentAction !== candidate) return 0;
    const run = Math.min(5, current.behavioralDynamics.actionRunLength);
    return current.behavioralDynamics.recentOutcomeValence >= 0
      ? run * 0.035
      : -0.2 * current.behavioralDynamics.postErrorChecking;
  };
  const habit = (candidate: AvailableAction): number => clamp(habits[candidate] ?? 0) * 0.65;
  const scores: Record<AvailableAction, number> = {
    observe: 0.7 + uncertainty + seed.cognition.attentionBreadth * 0.4 + (deliberated ? 0.2 : 0)
      + current.behavioralDynamics.postErrorChecking * 0.35 + habit("observe") + inertia("observe"),
    wait: 0.6 + uncertainty * 0.8 + seed.inhibitors.opportunityCostConcern * 0.4 + (deliberated ? 0.12 : 0)
      + current.behavioralDynamics.recoveryLoad * 0.25 + habit("wait") + inertia("wait"),
    hold: 0.7 + seed.referencePoints.ownershipAttachment * 0.6 + current.confidence * 0.2 + effectivePrudence * 0.15
      + habit("hold") + inertia("hold"),
    buy: 0.2 + opportunity * 1.4 + seed.motives.ryloAcquisitionDrive * 0.8
      + current.learnedPriors.marketConfidence * 0.25 + current.learnedPriors.scarcityExpectation * scarcity * 0.25
      + current.learnedPriors.riskTolerance * (1 - uncertainty) * 0.25 + effectiveAchievement * 0.18
      + Math.max(0, anchorGap) * seed.referencePoints.aspirationGapSensitivity * 0.35
      + current.selfModel.competence * 0.08 + habit("buy") + inertia("buy")
      - threat * 1.1 - seed.inhibitors.solvencyConcern * liquidityStress
      - current.behavioralDynamics.recoveryLoad * 0.35
      - (deliberated ? uncertainty * 0.35 + effectivePrudence * 0.15 : 0),
    sell: 0.2 + threat * 1.1 + liquidityStress * 0.8 - seed.referencePoints.ownershipAttachment * 0.3
      + effectivePrudence * threat * 0.15 - current.learnedPriors.marketConfidence * 0.1
      + Math.max(0, -anchorGap) * seed.referencePoints.regretSensitivity * 0.25
      + habit("sell") + inertia("sell"),
    abstain: 0.35 + uncertainty * 0.7 + goalConflict * 0.4 + habit("abstain") + inertia("abstain"),
    exit: 0.1 + threat * 0.8 + liquidityStress * 0.9 + habit("exit") + inertia("exit"),
  };
  const actionDistribution = distribution(scores, selectionTemperature);
  const actionTendency = selectAction(actionDistribution, random);
  const habitBias = round(clamp(habits[actionTendency] ?? 0));

  const nextContextHabits = structuredClone(current.behavioralDynamics.contextHabits);
  if (outcomeReward !== undefined && outcomeAction) {
    const contextValues = { ...(nextContextHabits[tag] ?? {}) };
    const previous = clamp(contextValues[outcomeAction] ?? 0);
    const habitChange = seed.learning.habitRate * weightedPredictionError;
    contextValues[outcomeAction] = round(clamp(previous + habitChange));
    nextContextHabits[tag] = contextValues;
  }
  const contextEntries = Object.entries(nextContextHabits);
  const boundedHabits = Object.fromEntries(contextEntries.slice(-16)) as BehavioralDynamics["contextHabits"];
  const negativeError = Math.max(0, -predictionError);
  const positiveError = Math.max(0, predictionError);
  const recoveryLoad = clamp(current.behavioralDynamics.recoveryLoad + negativeError * 0.3 - positiveError * 0.18);
  const postErrorChecking = clamp(current.behavioralDynamics.postErrorChecking + negativeError * 0.4 - positiveError * 0.2);
  const actionRunLength = current.behavioralDynamics.recentAction === actionTendency
    ? Math.min(20, current.behavioralDynamics.actionRunLength + 1)
    : 1;

  const observedPrice = currentPrice && currentPrice > 0 ? currentPrice : current.referenceLearning.priceAnchorXlm;
  const anchorDelta = bounded(effectiveLearningRate * 0.2 * (observedPrice - current.referenceLearning.priceAnchorXlm), 0.01);
  const expectedRewardDelta = outcomeReward === undefined
    ? 0
    : bounded(effectiveLearningRate * predictionError, seed.plasticity.learnedPriorPerEpisode);
  const internalAttribution = clamp(0.35 + Math.abs(reward) * seed.cognition.counterfactualDepth * 0.35);
  const nextSelfModel: SelfModel = canConsolidate ? {
    competence: clamp(current.selfModel.competence + direction * 0.003),
    agency: clamp(current.selfModel.agency + direction * internalAttribution * 0.002),
    prudence: clamp(current.selfModel.prudence - direction * 0.0015),
    consolidations: current.selfModel.consolidations + 1,
  } : current.selfModel;

  const nextState: NormalizedState = {
    ...current,
    schemaVersion: 2,
    revision: current.revision + 1,
    episodeCount: current.episodeCount + 1,
    lastEpisodeAt: event.occurredAt,
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
    behavioralDynamics: {
      recentAction: actionTendency,
      actionRunLength,
      recentOutcomeValence: outcomeReward === undefined ? current.behavioralDynamics.recentOutcomeValence : reward,
      recoveryLoad,
      postErrorChecking,
      contextHabits: boundedHabits,
    },
    referenceLearning: {
      priceAnchorXlm: Math.max(0.0000001, round(current.referenceLearning.priceAnchorXlm + anchorDelta)),
      expectedReward: round(clamp(current.referenceLearning.expectedReward + expectedRewardDelta, -1, 1)),
    },
    selfModel: nextSelfModel,
  };

  const decisionLatencyMs = Math.round(clamp(
    180 + attention * 260 + uncertainty * 420 + goalConflict * 380 + stakes * 180
      + retrievedMemories.length * 35 + current.behavioralDynamics.postErrorChecking * 320
      + (deliberated ? 520 + seed.cognition.counterfactualDepth * 480 : 0)
      + (latencyDraw - 0.5) * 100 - timePressure * 240,
    80,
    5_000,
  ));
  const memory: AgentMemory = {
    id: `episode:${event.eventId}`,
    kind: memoryKind(event, canConsolidate, outcomeAction),
    contextTag: tag,
    valence: round(experiencedValence),
    salience: round(clamp(0.35 * attention + 0.35 * surprise + 0.3 * stakes)),
    identityRelevance: round(clamp(goalConflict * 0.35 + accountability * 0.25 + Math.abs(experiencedValence) * 0.4)),
    occurredAt: event.occurredAt,
    payload: {
      eventType: event.type,
      actionTendency,
      outcomeAction,
      predictionError: round(predictionError),
      decisionLatencyMs,
      habitBias,
      recoveryLoad: round(recoveryLoad),
      appraisal: { opportunity: round(opportunity), threat: round(threat), surprise: round(surprise) },
    },
  };
  const nextMemories = [...memories.slice(-199), memory];

  return {
    state: nextState,
    memories: nextMemories,
    retrievedMemories,
    trace: {
      stages,
      deterministicDraw: round(random),
      attention: round(attention),
      appraisal: { opportunity: round(opportunity), threat: round(threat), surprise: round(surprise) },
      activeGoals: ["acquire_rylo_when_justified", "preserve_solvency", "maintain_identity_continuity", "recover_after_error"],
      fastProposal: opportunity > threat ? "buy" : threat > 0.7 ? "sell" : "observe",
      deliberationProbability: round(deliberationProbability),
      deliberated,
      attribution: {
        internal: round(internalAttribution),
        external: round(clamp(0.35 + surprise * 0.4)),
        uncertainty: round(uncertainty),
      },
      predictionError: round(predictionError),
      selectionTemperature: round(selectionTemperature),
      decisionLatencyMs,
      habitBias,
      recoveryMode: recoveryLoad > 0.15,
    },
    actionDistribution,
    actionTendency,
    deltas: { state: stateDelta, learnedPriors: priorDelta, identity: identityDelta },
    metrics: {
      effectiveLearningRate: round(effectiveLearningRate),
      memoryCount: nextMemories.length,
      predictionError: round(predictionError),
      behavioralEntropy: entropy(actionDistribution),
      decisionLatencyMs,
      habitStrength: habitBias,
      recoveryLoad: round(recoveryLoad),
    },
  };
}
