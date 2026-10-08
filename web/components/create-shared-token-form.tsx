"use client";

import { type FormEvent, useState } from "react";

import { SHARED_ASSET_DOMAIN } from "../lib/product/constants";
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
  const [previewReady, setPreviewReady] = useState(false);

  function updateField(field: keyof SharedAssetDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setPreviewReady(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateSharedAssetDraft(draft);
    setDraft(result.normalized);
    setErrors(result.errors);
    setPreviewReady(result.valid);
  }

  return (
    <form className="form-card guided-form" onSubmit={handleSubmit} noValidate>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Guided token draft</span>
          <h2>Build your preview</h2>
        </div>
        <span className="availability-badge">No on-chain submission</span>
      </div>

      <div className="draft-layout">
        <div className="draft-fields">
          <section className="draft-step" aria-labelledby="identity-step">
            <div className="step-heading">
              <span className="step-number">1</span>
              <div>
                <h3 id="identity-step">Token identity</h3>
                <p>
                  Choose the name people will recognize and the Stellar asset
                  code.
                </p>
              </div>
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
                  1–12 letters or numbers. Final uniqueness must be checked
                  before issuance.
                </small>
              )}
            </label>

            <label className="field">
              <span>Display name</span>
              <input
                name="displayName"
                value={draft.displayName}
                onChange={(event) =>
                  updateField("displayName", event.target.value)
                }
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
          </section>

          <section className="draft-step" aria-labelledby="metadata-step">
            <div className="step-heading">
              <span className="step-number">2</span>
              <div>
                <h3 id="metadata-step">Metadata</h3>
                <p>
                  Shared assets are planned to publish metadata through the
                  shared Orrylo asset domain.
                </p>
              </div>
            </div>
            <div className="metadata-summary">
              <span>Metadata home</span>
              <strong>{SHARED_ASSET_DOMAIN}</strong>
              <small>
                Additional metadata fields and publishing are coming soon; the
                final metadata schema remains undecided.
              </small>
            </div>
          </section>

          <div className="form-actions">
            <button type="submit" className="button button-primary">
              Preview token
            </button>
            <button type="button" className="button button-secondary" disabled>
              Launch token · Coming soon
            </button>
          </div>

          {previewReady ? (
            <p className="form-message" role="status">
              Preview ready. No token has been created or submitted to Stellar.
            </p>
          ) : null}
        </div>

        <aside className="draft-preview" aria-label="Token preview">
          <span className="eyebrow">3 · Preview</span>
          <div className="preview-token-mark" aria-hidden="true">
            {(draft.code || "T").slice(0, 1)}
          </div>
          <h3>{draft.displayName || "Your token"}</h3>
          <strong className="preview-code">{draft.code || "TOKEN"}</strong>
          <dl className="preview-facts">
            <div>
              <dt>Infrastructure</dt>
              <dd>Orrylo Shared Issuer</dd>
            </div>
            <div>
              <dt>Metadata</dt>
              <dd>{SHARED_ASSET_DOMAIN}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Draft only</dd>
            </div>
          </dl>
          <p>
            This preview is local UI state. It is not an issued asset and does
            not represent an on-chain transaction.
          </p>
        </aside>
      </div>
    </form>
  );
}
