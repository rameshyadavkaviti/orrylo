import type { CreateManagedProjectRequest } from "./managed-project-api";
import type {
  SharedAssetDraft,
  SharedAssetDraftErrors,
} from "../validation/token";
import { validateSharedAssetDraft } from "../validation/token";

export interface PendingManagedProjectSave {
  normalizedDraft: SharedAssetDraft;
  request: CreateManagedProjectRequest;
}

export type PrepareManagedProjectSaveResult =
  | {
      ok: true;
      pending: PendingManagedProjectSave;
      errors: SharedAssetDraftErrors;
    }
  | {
      ok: false;
      normalizedDraft: SharedAssetDraft;
      errors: SharedAssetDraftErrors;
    };

export function prepareManagedProjectSave(
  draft: SharedAssetDraft,
  idempotencyKey: string,
): PrepareManagedProjectSaveResult {
  const validation = validateSharedAssetDraft(draft);

  if (!validation.valid) {
    return {
      ok: false,
      normalizedDraft: validation.normalized,
      errors: validation.errors,
    };
  }

  return {
    ok: true,
    errors: validation.errors,
    pending: {
      normalizedDraft: validation.normalized,
      request: {
        idempotencyKey,
        code: validation.normalized.code,
        displayName: validation.normalized.displayName,
        description: validation.normalized.description,
      },
    },
  };
}

export function withWalletContinuityAssertion(
  pending: PendingManagedProjectSave,
  authenticatedWalletAssertion: string,
): PendingManagedProjectSave {
  return {
    normalizedDraft: pending.normalizedDraft,
    request: {
      ...pending.request,
      authenticatedWalletAssertion,
    },
  };
}
