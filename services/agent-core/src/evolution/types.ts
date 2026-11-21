import type { AvailableAction } from "../identity/types.js";

export type EventType = "market_observation" | "decision_outcome" | "social_signal" | "operator_feedback" | "evaluation_probe";

export interface AgentEvent {
  eventId: string;
  type: EventType;
  sequence: number;
  occurredAt: string;
  source: string;
  context: Record<string, unknown>;
  outcome?: Record<string, unknown>;
}

export interface IdentityEvidence {
  direction: -1 | 1;
  contextTag: string;
}

export interface AgentState {
  schemaVersion: 1 | 2;
  revision: number;
  episodeCount: number;
  affect: number;
  arousal: number;
  stress: number;
  energy: number;
  confidence: number;
  urgency: number;
  feltSecurity: number;
  cognitiveLoad: number;
  learnedPriors: {
    marketConfidence: number;
    scarcityExpectation: number;
    socialTrust: number;
    riskTolerance: number;
  };
  identityAdjustments: {
    achievement: number;
    prudence: number;
  };
  identityEvidence: IdentityEvidence[];
  lastEpisodeAt?: string;
  behavioralDynamics?: {
    recentAction: AvailableAction | null;
    actionRunLength: number;
    recentOutcomeValence: number;
    recoveryLoad: number;
    postErrorChecking: number;
    contextHabits: Record<string, Partial<Record<AvailableAction, number>>>;
  };
  referenceLearning?: {
    priceAnchorXlm: number;
    expectedReward: number;
  };
  selfModel?: {
    competence: number;
    agency: number;
    prudence: number;
    consolidations: number;
  };
}

export interface AgentMemory {
  id: string;
  kind: "episodic" | "semantic" | "procedural" | "social" | "narrative";
  contextTag: string;
  valence: number;
  salience: number;
  identityRelevance: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface EpisodeTrace {
  stages: readonly string[];
  deterministicDraw: number;
  attention: number;
  appraisal: { opportunity: number; threat: number; surprise: number };
  activeGoals: readonly string[];
  fastProposal: AvailableAction;
  deliberationProbability: number;
  deliberated: boolean;
  attribution: { internal: number; external: number; uncertainty: number };
  predictionError: number;
  selectionTemperature: number;
  decisionLatencyMs: number;
  habitBias: number;
  recoveryMode: boolean;
}

export interface EvolutionResult {
  state: AgentState;
  memories: AgentMemory[];
  retrievedMemories: AgentMemory[];
  trace: EpisodeTrace;
  actionDistribution: Record<AvailableAction, number>;
  actionTendency: AvailableAction;
  deltas: {
    state: Record<string, number>;
    learnedPriors: Record<string, number>;
    identity: Record<string, number>;
  };
  metrics: {
    effectiveLearningRate: number;
    memoryCount: number;
    predictionError: number;
    behavioralEntropy: number;
    decisionLatencyMs: number;
    habitStrength: number;
    recoveryLoad: number;
  };
}
