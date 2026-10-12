import {
  type SharedAssetDraft,
  type SharedAssetDraftErrors,
  validateSharedAssetDraft,
} from "../validation/token";
import { validateInitialSupply } from "../validation/initial-supply";

/**
 * Browser-only review of token preferences. It is NOT a saved amount or
 * an issuance order, and its review key is NOT an execution fingerprint.
 */
export interface TokenBuilderReview {
  assetCode: string;
  displayName: string;
  description: string;
  initialSupply: string;
  initialSupplyStroops: string;
  logoFileName: string | null;
}

export type PrepareTokenBuilderReview =
  | { valid: true; review: TokenBuilderReview; errors: SharedAssetDraftErrors }
  | {
      valid: false;
      errors: SharedAssetDraftErrors;
      supplyError: string | null;
    };

export function prepareTokenBuilderReview(
  draft: SharedAssetDraft,
  initialSupply: string,
  logoFileName: string | null,
): PrepareTokenBuilderReview {
  const project = validateSharedAssetDraft(draft);
  const supply = validateInitialSupply(initialSupply);
  if (!project.valid || !supply.valid) {
    return {
      valid: false,
      errors: project.errors,
      supplyError: supply.valid ? null : supply.error,
    };
  }
  return {
    valid: true,
    errors: {},
    review: {
      assetCode: project.normalized.code,
      displayName: project.normalized.displayName,
      description: project.normalized.description,
      initialSupply: supply.normalized,
      initialSupplyStroops: supply.stroops.toString(),
      logoFileName,
    },
  };
}

export function matchesCurrentBuilderReview(
  review: TokenBuilderReview,
  draft: SharedAssetDraft,
  supply: string,
  logoFileName: string | null,
): boolean {
  const current = prepareTokenBuilderReview(draft, supply, logoFileName);
  return (
    current.valid &&
    current.review.assetCode === review.assetCode &&
    current.review.displayName === review.displayName &&
    current.review.description === review.description &&
    current.review.initialSupplyStroops === review.initialSupplyStroops &&
    current.review.logoFileName === review.logoFileName
  );
}
