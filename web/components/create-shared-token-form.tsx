"use client";

import { type FormEvent, useState } from "react";

import {
  type SharedAssetDraft,
  type SharedAssetDraftErrors,
  validateSharedAssetDraft,
} from "../lib/validation/token";

const INITIAL_DRAFT: SharedAssetDraft = {
  code: "",
  displayName: "",
};

export function CreateSharedTokenForm() {
  const [draft, setDraft] = useState<SharedAssetDraft>(INITIAL_DRAFT);
  const [errors, setErrors] = useState<SharedAssetDraftErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  function updateField(field: keyof SharedAssetDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateSharedAssetDraft(draft);
    setDraft(result.normalized);
    setErrors(result.errors);

    if (result.valid) {
      setMessage(
        "Draft is valid. Real token issuance is intentionally unavailable in Application Phase 1.",
      );
    }
  }

  return (
    <form className="form-card" onSubmit={handleSubmit} noValidate>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Shared Issuer draft</span>
          <h2>Configure the asset</h2>
        </div>
        <span className="availability-badge">No chain submission</span>
      </div>

      <label className="field">
        <span>Asset code</span>
        <input
          name="code"
          value={draft.code}
          onChange={(event) => updateField("code", event.target.value)}
          placeholder="MYTOKEN"
          autoComplete="off"
          aria-describedby={errors.code ? "code-error" : "code-help"}
        />
        {errors.code ? (
          <small id="code-error" className="field-error">
            {errors.code}
          </small>
        ) : (
          <small id="code-help">
            1–12 letters or numbers. Shared-issuer uniqueness is a future
            server-side check.
          </small>
        )}
      </label>

      <label className="field">
        <span>Display name</span>
        <input
          name="displayName"
          value={draft.displayName}
          onChange={(event) => updateField("displayName", event.target.value)}
          placeholder="My Token"
          autoComplete="off"
          aria-describedby={errors.displayName ? "name-error" : undefined}
        />
        {errors.displayName ? (
          <small id="name-error" className="field-error">
            {errors.displayName}
          </small>
        ) : null}
      </label>

      <div className="form-actions">
        <button type="submit" className="button button-primary">
          Validate draft
        </button>
        <button type="button" className="button button-secondary" disabled>
          Create token · unavailable
        </button>
      </div>

      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
