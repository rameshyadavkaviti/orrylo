export const marketActions = ["observe", "wait", "hold", "buy", "sell", "abstain", "exit"] as const;
export const claimableActions = ["claim", "defer", "decline"] as const;
export const availableActions = [...marketActions, ...claimableActions] as const;
export type AvailableAction = (typeof availableActions)[number];

export interface CognitiveSeed {
  schemaVersion: 1;
  keyVersion: number;
  fingerprint: string;
  values: {
    achievement: number;
    autonomy: number;
    prudence: number;
    fairness: number;
    novelty: number;
  };
  sensitivities: {
    relativeStatus: number;
    scarcity: number;
    loss: number;
    socialEvaluation: number;
  };
  motives: {
    ryloCompetitionDrive: number;
    ryloAcquisitionDrive: number;
    securityDrive: number;
    coherenceDrive: number;
  };
  inhibitors: {
    solvencyConcern: number;
    opportunityCostConcern: number;
    uncertaintyAversion: number;
    reputationConcern: number;
  };
  cognition: {
    deliberationThreshold: number;
    explorationTendency: number;
    attentionBreadth: number;
    counterfactualDepth: number;
  };
  learning: {
    baseRate: number;
    negativeOutcomeWeight: number;
    socialEvidenceWeight: number;
    habitRate: number;
  };
  referencePoints: {
    ownershipAttachment: number;
    aspirationGapSensitivity: number;
    regretSensitivity: number;
  };
  socialPriors: {
    baselineTrust: number;
    reciprocity: number;
    conformity: number;
    dissentConfidence: number;
  };
  plasticity: {
    statePerEpisode: 0.15;
    learnedPriorPerEpisode: 0.02;
    identityPerConsolidation: 0.005;
    identityEvidenceEpisodes: 12;
    identityEvidenceContexts: 3;
  };
  availableActions: readonly AvailableAction[];
}
