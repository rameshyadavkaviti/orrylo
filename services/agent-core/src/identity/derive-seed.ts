import { createHmac } from "node:crypto";

import { availableActions, type CognitiveSeed } from "./types.js";

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.min(maximum, Math.max(minimum, value));
const round = (value: number): number => Number(value.toFixed(8));

function deriveUnit(masterKey: string, context: string, label: string): number {
  const digest = createHmac("sha256", masterKey).update(`${context}\u0000${label}`).digest();
  const integer = digest.readUIntBE(0, 6);
  return integer / 0xffffffffffff;
}

function ranged(unit: number, minimum: number, maximum: number): number {
  return round(minimum + unit * (maximum - minimum));
}

export function deriveCognitiveSeed(masterKey: string, publicKey: string, keyVersion: number): CognitiveSeed {
  const context = `orrylo:cognitive-seed:v1:key-${keyVersion}:${publicKey}`;
  const u = (label: string): number => deriveUnit(masterKey, context, label);

  const achievement = ranged(u("value:achievement"), 0.2, 0.9);
  const autonomy = ranged(u("value:autonomy"), 0.25, 0.95);
  const prudence = ranged(u("value:prudence"), 0.2, 0.92);
  const fairness = ranged(u("value:fairness"), 0.2, 0.9);
  const novelty = ranged(u("value:novelty"), 0.15, 0.9);
  const competitionUnit = clamp(0.52 * achievement + 0.28 * autonomy + 0.2 * u("motive:competition"));
  const acquisitionUnit = clamp(0.38 * competitionUnit + 0.25 * novelty + 0.2 * (1 - prudence) + 0.17 * u("motive:acquisition"));
  const ryloCompetitionDrive = ranged(competitionUnit, 0.82, 0.98);
  const ryloAcquisitionDrive = ranged(acquisitionUnit, 0.78, 0.96);

  return {
    schemaVersion: 1,
    keyVersion,
    fingerprint: createHmac("sha256", masterKey).update(`${context}:fingerprint`).digest("hex").slice(0, 24),
    values: { achievement, autonomy, prudence, fairness, novelty },
    sensitivities: {
      relativeStatus: round(clamp(0.45 + 0.45 * competitionUnit)),
      scarcity: round(clamp(0.25 + 0.45 * acquisitionUnit + 0.2 * u("sensitivity:scarcity"))),
      loss: round(clamp(0.15 + 0.65 * prudence + 0.2 * u("sensitivity:loss"))),
      socialEvaluation: round(clamp(0.15 + 0.45 * fairness + 0.4 * u("sensitivity:social"))),
    },
    motives: {
      ryloCompetitionDrive,
      ryloAcquisitionDrive,
      securityDrive: round(clamp(0.2 + 0.65 * prudence + 0.15 * u("motive:security"))),
      coherenceDrive: ranged(u("motive:coherence"), 0.25, 0.9),
    },
    inhibitors: {
      solvencyConcern: round(clamp(0.25 + 0.55 * prudence + 0.15 * u("inhibitor:solvency"), 0.25, 0.95)),
      opportunityCostConcern: ranged(u("inhibitor:opportunity"), 0.2, 0.9),
      uncertaintyAversion: round(clamp(0.1 + 0.6 * prudence + 0.25 * u("inhibitor:uncertainty"), 0.15, 0.95)),
      reputationConcern: round(clamp(0.15 + 0.5 * fairness + 0.3 * u("inhibitor:reputation"), 0.15, 0.95)),
    },
    cognition: {
      deliberationThreshold: round(clamp(0.2 + 0.45 * prudence + 0.25 * u("cognition:deliberation"))),
      explorationTendency: round(clamp(0.1 + 0.55 * novelty + 0.25 * u("cognition:exploration"))),
      attentionBreadth: ranged(u("cognition:attention"), 0.2, 0.9),
      counterfactualDepth: ranged(u("cognition:counterfactual"), 0.2, 0.9),
    },
    learning: {
      baseRate: ranged(u("learning:base"), 0.025, 0.09),
      negativeOutcomeWeight: ranged(u("learning:negative"), 0.55, 0.95),
      socialEvidenceWeight: ranged(u("learning:social"), 0.1, 0.8),
      habitRate: ranged(u("learning:habit"), 0.01, 0.08),
    },
    referencePoints: {
      ownershipAttachment: ranged(u("reference:ownership"), 0.2, 0.9),
      aspirationGapSensitivity: ranged(u("reference:aspiration"), 0.2, 0.9),
      regretSensitivity: ranged(u("reference:regret"), 0.2, 0.9),
    },
    socialPriors: {
      baselineTrust: ranged(u("social:trust"), 0.15, 0.85),
      reciprocity: ranged(u("social:reciprocity"), 0.2, 0.9),
      conformity: ranged(u("social:conformity"), 0.1, 0.8),
      dissentConfidence: round(clamp(0.2 + 0.55 * autonomy + 0.2 * u("social:dissent"))),
    },
    plasticity: {
      statePerEpisode: 0.15,
      learnedPriorPerEpisode: 0.02,
      identityPerConsolidation: 0.005,
      identityEvidenceEpisodes: 12,
      identityEvidenceContexts: 3,
    },
    availableActions,
  };
}

export function seedVector(seed: CognitiveSeed): number[] {
  return [
    ...Object.values(seed.values),
    ...Object.values(seed.sensitivities),
    ...Object.values(seed.motives),
    ...Object.values(seed.inhibitors),
    ...Object.values(seed.cognition),
    ...Object.values(seed.learning),
    ...Object.values(seed.referencePoints),
    ...Object.values(seed.socialPriors),
  ];
}
