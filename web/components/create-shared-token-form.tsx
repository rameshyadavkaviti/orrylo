"use client";

import Image from "next/image";
import { type ChangeEvent, type FormEvent, useState } from "react";

import { SHARED_ASSET_DOMAIN } from "../lib/product/constants";
import {
  type SharedAssetDraft,
  type SharedAssetDraftErrors,
  TOKEN_DESCRIPTION_MAX_LENGTH,
  validateSharedAssetDraft,
} from "../lib/validation/token";

const INITIAL_DRAFT: SharedAssetDraft = {
  code: "",
  displayName: "",
  description: "",
};

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function CreateSharedTokenForm() {
  const [draft, setDraft] = useState<SharedAssetDraft>(INITIAL_DRAFT);
  const [errors, setErrors] = useState<SharedAssetDraftErrors>({});
  const [configurationReady, setConfigurationReady] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  function updateField(field: keyof SharedAssetDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setConfigurationReady(false);
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setLogoError(null);

    if (!file) {
      setLogoPreview(null);
      setLogoName(null);
      return;
    }

    if (!LOGO_TYPES.has(file.type)) {
      setLogoError("Use a PNG, JPEG, or WebP image for the preview.");
      event.target.value = "";
      return;
    }

    if (file.size > LOGO_MAX_BYTES) {
      setLogoError("Keep the preview image at 2 MB or less.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogoPreview(reader.result);
        setLogoName(file.name);
      }
    };

    reader.onerror = () => {
      setLogoError("The image could not be loaded. Try another file.");
      setLogoPreview(null);
      setLogoName(null);
    };

    reader.readAsDataURL(file);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateSharedAssetDraft(draft);
    setDraft(result.normalized);
    setErrors(result.errors);
    setConfigurationReady(result.valid);
  }

  const previewCode = draft.code.trim().toUpperCase() || "TOKEN";
  const previewName = draft.displayName.trim() || "Your token";
  const previewDescription =
    draft.description.trim() ||
    "Add a short description to show people what your token is for.";

  return (
    <form className="form-card guided-form" onSubmit={handleSubmit} noValidate>
      <div className="builder-heading">
        <div>
          <span className="eyebrow">Interactive token builder</span>
          <h2>Shape the token you want Orrylo to create.</h2>
          <p>
            Everything below is available without a wallet. Your preview updates
            as you build.
          </p>
        </div>
        <span className="builder-anonymous-note">No wallet required</span>
      </div>

      <div className="draft-layout">
        <div className="draft-fields">
          <section className="draft-step" aria-labelledby="identity-step">
            <div className="step-heading">
              <span className="step-number">1</span>
              <div>
                <h3 id="identity-step">Token identity</h3>
                <p>
                  Choose the name, Stellar asset code, and short story people
                  will see first.
                </p>
              </div>
            </div>

            <div className="builder-field-grid">
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
                    1–12 letters or numbers. Final uniqueness is checked before
                    issuance.
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
                  aria-describedby={
                    errors.displayName ? "name-error" : undefined
                  }
                />
                {errors.displayName ? (
                  <small id="name-error" className="field-error">
                    {errors.displayName}
                  </small>
                ) : (
                  <small>2–40 characters for this product preview.</small>
                )}
              </label>
            </div>

            <label className="field">
              <span>Description</span>
              <textarea
                name="description"
                value={draft.description}
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
                placeholder="What does your token represent or enable?"
                rows={4}
                maxLength={TOKEN_DESCRIPTION_MAX_LENGTH + 1}
                aria-describedby={
                  errors.description ? "description-error" : "description-help"
                }
              />
              {errors.description ? (
                <small id="description-error" className="field-error">
                  {errors.description}
                </small>
              ) : (
                <small id="description-help">
                  Optional preview copy · {draft.description.length}/
                  {TOKEN_DESCRIPTION_MAX_LENGTH}
                </small>
              )}
            </label>
          </section>

          <section className="draft-step" aria-labelledby="brand-step">
            <div className="step-heading">
              <span className="step-number">2</span>
              <div>
                <h3 id="brand-step">Logo &amp; presentation</h3>
                <p>
                  Add a local image to make the token preview feel like your
                  project. Nothing is uploaded to Orrylo.
                </p>
              </div>
            </div>

            <label className="field logo-field">
              <span>Token logo</span>
              <input
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoChange}
                aria-describedby={logoError ? "logo-error" : "logo-help"}
              />
              {logoError ? (
                <small id="logo-error" className="field-error">
                  {logoError}
                </small>
              ) : (
                <small id="logo-help">
                  PNG, JPEG, or WebP · up to 2 MB · previewed in this browser
                  only{logoName ? " · " + logoName : ""}
                </small>
              )}
            </label>
          </section>

          <section className="draft-step" aria-labelledby="infrastructure-step">
            <div className="step-heading">
              <span className="step-number">3</span>
              <div>
                <h3 id="infrastructure-step">Infrastructure</h3>
                <p>
                  See which Orrylo model would sit behind the asset without
                  choosing unresolved production rules.
                </p>
              </div>
            </div>

            <div className="infrastructure-options">
              <article className="infrastructure-option infrastructure-selected">
                <span className="option-check" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <strong>Shared Issuer</strong>
                  <p>
                    Orrylo-controlled shared infrastructure with asset identity
                    defined by code + issuer.
                  </p>
                  <small>Selected for the current builder prototype</small>
                </div>
              </article>

              <article className="infrastructure-option infrastructure-disabled">
                <span className="availability-badge">Coming soon</span>
                <div>
                  <strong>Dedicated Issuer</strong>
                  <p>
                    Separate infrastructure targeting Orrylo&apos;s approved
                    contract-controlled issuer architecture.
                  </p>
                  <small>Templates and provisioning are not implemented.</small>
                </div>
              </article>
            </div>
          </section>

          <section className="draft-step" aria-labelledby="metadata-step">
            <div className="step-heading">
              <span className="step-number">4</span>
              <div>
                <h3 id="metadata-step">Metadata preview</h3>
                <p>
                  Shared assets use Orrylo&apos;s shared metadata domain. The
                  final production metadata schema is still an open decision.
                </p>
              </div>
            </div>

            <div className="metadata-summary">
              <span>Expected shared metadata home</span>
              <strong>{SHARED_ASSET_DOMAIN}</strong>
              <small>
                The builder previews identity and presentation fields only; it
                does not declare an unresolved metadata field mandatory.
              </small>
            </div>
          </section>

          <div className="form-actions">
            <button type="submit" className="button button-primary">
              Check configuration
            </button>
          </div>

          {configurationReady ? (
            <p className="form-message" role="status">
              Configuration looks good. Review the live product preview.
            </p>
          ) : null}
        </div>

        <aside className="draft-preview" aria-label="Live token preview">
          <div className="preview-header">
            <div>
              <span className="eyebrow">Live token preview</span>
              <small>Updates as you build</small>
            </div>
            <span className="preview-network">Stellar</span>
          </div>

          {logoPreview ? (
            <Image
              className="preview-token-logo"
              src={logoPreview}
              alt=""
              width={88}
              height={88}
              unoptimized
            />
          ) : (
            <div className="preview-token-mark" aria-hidden="true">
              {previewCode.slice(0, 1)}
            </div>
          )}

          <h3>{previewName}</h3>
          <strong className="preview-code">{previewCode}</strong>
          <p className="preview-description">{previewDescription}</p>

          <dl className="preview-facts">
            <div>
              <dt>Network</dt>
              <dd>Stellar</dd>
            </div>
            <div>
              <dt>Issuer model</dt>
              <dd>Orrylo Shared Issuer</dd>
            </div>
            <div>
              <dt>Metadata home</dt>
              <dd>{SHARED_ASSET_DOMAIN}</dd>
            </div>
          </dl>

          <div className="execution-boundary">
            <span className="eyebrow">On-chain boundary</span>
            <strong>Ready for the next step when launch is supported.</strong>
            <p>
              This configuration has not created a Stellar asset. Wallet
              authentication and Stellar execution belong at the launch
              boundary, not in the anonymous builder.
            </p>
            <button className="button button-secondary" type="button" disabled>
              Continue to on-chain launch
            </button>
          </div>
        </aside>
      </div>
    </form>
  );
}
