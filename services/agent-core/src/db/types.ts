import type { AgentState } from "../evolution/types.js";
import type { CognitiveSeed } from "../identity/types.js";

export interface EnrollInput {
  alias: string;
  publicKey: string;
  seed: CognitiveSeed;
  state: AgentState;
}

export interface AgentProjection {
  id: string;
  alias: string;
  publicKey: string;
  configured: boolean;
  revision: number;
  episodeCount: number;
  createdAt: string;
  updatedAt: string;
  valuationSummary?: {
    learnedPriceAnchorXlm: number;
    riskTolerance: number;
    optimism?: number;
    patience?: number;
    scarcityExpectation?: number;
  };
  cognitiveSummary: {
    affect: number;
    stress: number;
    confidence: number;
    urgency: number;
    feltSecurity: number;
  };
  behavioralSummary: {
    lastAction: string | null;
    actionRunLength: number;
    lastEpisodeAt: string | null;
  };
}

export interface EvolutionReceipt {
  eventId: string;
  agentId: string;
  sequence: number;
  revision: number;
  duplicate: boolean;
  actionTendency: string;
  deliberated: boolean;
}

export interface RepositoryMetrics {
  agents: number;
  configuredAgents: number;
  episodes: number;
  memories: number;
  invalidCandidates: number;
}

export interface RepositoryReadiness {
  database: boolean;
  migrated: boolean;
  enrollmentHealthy: boolean;
  invalidCandidates: number;
}

export interface ExecutionRecord {
  transactionHash: string;
  kind: "claim" | "trade";
  action: "claim" | "buy" | "sell";
  amountRylo: number;
  priceXlm?: number;
  maxXlm: number;
  createdAt: string;
}
