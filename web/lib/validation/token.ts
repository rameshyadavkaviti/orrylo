export interface SharedAssetDraft {
  code: string;
  displayName: string;
  description: string;
}

export type SharedAssetDraftErrors = Partial<
  Record<keyof SharedAssetDraft, string>
>;

export interface ValidationResult {
  valid: boolean;
  errors: SharedAssetDraftErrors;
  normalized: SharedAssetDraft;
}

const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
export const TOKEN_DESCRIPTION_MAX_LENGTH = 280;

export function validateSharedAssetDraft(
  draft: SharedAssetDraft,
): ValidationResult {
  const normalized = {
    code: draft.code.trim().toUpperCase(),
    displayName: draft.displayName.trim(),
    description: draft.description.trim(),
  };
  const errors: SharedAssetDraftErrors = {};

  if (!ASSET_CODE_PATTERN.test(normalized.code)) {
    errors.code =
      "Use 1–12 uppercase letters or numbers. Uniqueness will be checked before real issuance is enabled.";
  }

  if (normalized.displayName.length < 2 || normalized.displayName.length > 40) {
    errors.displayName = "Display name must be between 2 and 40 characters.";
  }

  if (normalized.description.length > TOKEN_DESCRIPTION_MAX_LENGTH) {
    errors.description =
      "Description must be 280 characters or fewer for this preview.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized,
  };
}
