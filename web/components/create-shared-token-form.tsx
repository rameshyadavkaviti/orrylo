"use client";

import Image from "next/image";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";

import type {
  CreateManagedProjectFailure,
  CreateManagedProjectSuccess,
} from "../lib/projects/managed-project-api";
import {
  prepareManagedProjectSave,
  type PendingManagedProjectSave,
} from "../lib/projects/pending-managed-project";
import { SHARED_ASSET_DOMAIN } from "../lib/product/constants";
import {
  type SharedAssetDraft,
  type SharedAssetDraftErrors,
  TOKEN_DESCRIPTION_MAX_LENGTH,
  validateSharedAssetDraft,
} from "../lib/validation/token";
import { WalletAuthControl } from "./wallet-auth-control";

const INITIAL_DRAFT: SharedAssetDraft = {
  code: "",
  displayName: "",
  description: "",
};

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "needs_wallet" }
  | { status: "failure"; message: string };

export function CreateSharedTokenForm() {
  const [draft, setDraft] = useState<SharedAssetDraft>(INITIAL_DRAFT);
  const [errors, setErrors] = useState<SharedAssetDraftErrors>({});
  const [configurationReady, setConfigurationReady] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const idempotencyKeyRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<PendingManagedProjectSave | null>(null);

  function updateField(field: keyof SharedAssetDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setConfigurationReady(false);
    setSaveState({ status: "idle" });
    idempotencyKeyRef.current = null;
    pendingSaveRef.current = null;
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

  function validateCurrentDraft(): SharedAssetDraft | null {
    const result = validateSharedAssetDraft(draft);
    setDraft(result.normalized);
    setErrors(result.errors);
    setConfigurationReady(result.valid);

    return result.valid ? result.normalized : null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    validateCurrentDraft();
  }

  async function handleSaveProject() {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    const prepared = prepareManagedProjectSave(
      draft,
      idempotencyKeyRef.current,
    );

    setDraft(
      prepared.ok ? prepared.pending.normalizedDraft : prepared.normalizedDraft,
    );
    setErrors(prepared.errors);
    setConfigurationReady(prepared.ok);

    if (!prepared.ok) {
      setSaveState({
        status: "failure",
        message: "Review the highlighted token details before saving.",
      });
      return;
    }

    pendingSaveRef.current = prepared.pending;
    await persistProject(prepared.pending);
  }

  async function persistProject(pending: PendingManagedProjectSave) {
    setSaveState({ status: "saving" });

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(pending.request),
      });
      const result = await readJson<
        CreateManagedProjectSuccess | CreateManagedProjectFailure
      >(response);

      if (
        response.status === 401 &&
        result &&
        !result.ok &&
        result.code === "unauthenticated"
      ) {
        setSaveState({ status: "needs_wallet" });
        return;
      }

      if (!response.ok || !result || !result.ok) {
        setSaveState({
          status: "failure",
          message: describeProjectSaveFailure(result),
        });
        return;
      }

      window.location.assign(result.managePath);
    } catch {
      setSaveState({
        status: "failure",
        message:
          "Orrylo could not save the project right now. Your configuration is still on this page.",
      });
    }
  }

  async function continueAfterAuthentication() {
    const pendingSave = pendingSaveRef.current;

    if (!pendingSave) {
      setSaveState({
        status: "failure",
        message: "Review the project once more before saving.",
      });
      return;
    }

    await persistProject(pendingSave);
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
            <button type="submit" className="button button-secondary">
              Check configuration
            </button>
          </div>

          {configurationReady ? (
            <p className="form-message" role="status">
              Configuration looks good. You can save it as a managed Orrylo
              project whenever you are ready.
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
            <span className="eyebrow">Ready to manage</span>
            <strong>Save this as your managed Orrylo project.</strong>
            <p>
              Your wallet is used here only to prove who owns the Project
              Profile. Saving does not create a Stellar asset, sign a
              transaction, or publish TOML metadata.
            </p>
            <button
              className="button button-primary"
              type="button"
              disabled={saveState.status === "saving"}
              onClick={() => void handleSaveProject()}
            >
              {saveState.status === "saving"
                ? "Saving project…"
                : "Save & manage project"}
            </button>

            {saveState.status === "needs_wallet" ? (
              <div className="builder-wallet-boundary">
                <p>
                  Connect with Albedo to claim this Project Profile. Your
                  configured values stay on this page while authentication
                  completes.
                </p>
                <WalletAuthControl
                  connectLabel="Connect wallet & save"
                  onAuthenticated={() => void continueAfterAuthentication()}
                />
              </div>
            ) : null}

            {saveState.status === "failure" ? (
              <p className="field-error" role="alert">
                {saveState.message}
              </p>
            ) : null}

            <small className="builder-boundary-note">
              On-chain issuance remains a separate later step.
            </small>
          </div>
        </aside>
      </div>
    </form>
  );
}

function describeProjectSaveFailure(
  result: CreateManagedProjectSuccess | CreateManagedProjectFailure | null,
): string {
  if (!result || result.ok) {
    return "Orrylo could not save the project. Your configuration is still on this page.";
  }

  switch (result.code) {
    case "invalid_project":
    case "invalid_request":
      return "Review the token details and try saving again.";
    case "invalid_idempotency_key":
    case "idempotency_conflict":
      return "This save attempt no longer matches the current project. Change a field or retry from the current configuration.";
    case "slug_unavailable":
      return "Orrylo could not reserve a public project path for this name. Try a more distinctive display name.";
    case "untrusted_origin":
      return "Project saving is not configured for this site address yet. Your anonymous builder state is unchanged.";
    case "database_failure":
      return "Project saving is temporarily unavailable. Your configuration is still on this page.";
    case "unauthenticated":
      return "Connect your wallet to save and manage this project.";
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
