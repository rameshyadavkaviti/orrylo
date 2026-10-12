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
  withWalletContinuityAssertion,
} from "../lib/projects/pending-managed-project";
import {
  matchesCurrentBuilderReview,
  prepareTokenBuilderReview,
  type TokenBuilderReview,
} from "../lib/projects/token-builder-review";
import { SHARED_ASSET_DOMAIN } from "../lib/product/constants";
import { validateInitialSupply } from "../lib/validation/initial-supply";
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
  | { status: "wallet_session_changed" }
  | { status: "failure"; message: string };

export function CreateSharedTokenForm() {
  const [draft, setDraft] = useState<SharedAssetDraft>(INITIAL_DRAFT);
  const [errors, setErrors] = useState<SharedAssetDraftErrors>({});
  const [initialSupply, setInitialSupply] = useState("");
  const [initialSupplyError, setInitialSupplyError] = useState<string | null>(
    null,
  );
  const [review, setReview] = useState<TokenBuilderReview | null>(null);
  const [acknowledgedProfileOnlySave, setAcknowledgedProfileOnlySave] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const idempotencyKeyRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<PendingManagedProjectSave | null>(null);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const logoReadVersionRef = useRef(0);

  function invalidateReview() {
    revisionRef.current += 1;
    setReview(null);
    setAcknowledgedProfileOnlySave(false);
    setSaveState({ status: "idle" });
    idempotencyKeyRef.current = null;
    pendingSaveRef.current = null;
  }

  function updateField(field: keyof SharedAssetDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    invalidateReview();
  }

  function updateInitialSupply(value: string) {
    setInitialSupply(value);
    setInitialSupplyError(null);
    invalidateReview();
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const readVersion = ++logoReadVersionRef.current;
    invalidateReview();
    setLogoError(null);
    setLogoPreview(null);
    setLogoName(null);

    if (!file) return;

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
      if (readVersion === logoReadVersionRef.current && typeof reader.result === "string") {
        setLogoPreview(reader.result);
        setLogoName(file.name);
      }
    };

    reader.onerror = () => {
      if (readVersion === logoReadVersionRef.current) {
        setLogoError("The image could not be loaded. Try another file.");
        setLogoPreview(null);
        setLogoName(null);
      }
    };

    reader.readAsDataURL(file);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = prepareTokenBuilderReview(draft, initialSupply, logoName);
    const project = validateSharedAssetDraft(draft);
    setErrors(project.errors);
    setInitialSupplyError(checked.valid ? null : checked.supplyError);
    if (!checked.valid || logoError) {
      setReview(null);
      setAcknowledgedProfileOnlySave(false);
      return;
    }
    setDraft(project.normalized);
    setReview(checked.review);
    setAcknowledgedProfileOnlySave(false);
    setSaveState({ status: "idle" });
  }

  async function handleSaveProject() {
    if (
      !review ||
      !acknowledgedProfileOnlySave ||
      !matchesCurrentBuilderReview(review, draft, initialSupply, logoName) ||
      logoError
    ) {
      setSaveState({
        status: "failure",
        message: "Review the configuration and acknowledge that the supply is not saved.",
      });
      return;
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    const prepared = prepareManagedProjectSave(draft, idempotencyKeyRef.current);
    setErrors(prepared.errors);
    if (!prepared.ok) {
      setReview(null);
      setAcknowledgedProfileOnlySave(false);
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
    if (savingRef.current) return;
    savingRef.current = true;
    const submittedRevision = revisionRef.current;
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

      // Discard responses tied to older browser edits or wallet continuations.
      if (submittedRevision !== revisionRef.current) return;

      if (
        response.status === 401 &&
        result &&
        !result.ok &&
        result.code === "unauthenticated"
      ) {
        setSaveState({ status: "needs_wallet" });
        return;
      }

      if (
        response.status === 409 &&
        result &&
        !result.ok &&
        result.code === "wallet_session_changed"
      ) {
        setSaveState({ status: "wallet_session_changed" });
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
      if (submittedRevision === revisionRef.current) {
        setSaveState({
          status: "failure",
          message:
            "Orrylo could not save the project right now. Your configuration is still on this page.",
        });
      }
    } finally {
      savingRef.current = false;
    }
  }

  async function continueAfterAuthentication(publicKey: string) {
    const pendingSave = pendingSaveRef.current;

    if (
      !pendingSave ||
      !review ||
      !acknowledgedProfileOnlySave ||
      !matchesCurrentBuilderReview(review, draft, initialSupply, logoName)
    ) {
      setSaveState({
        status: "failure",
        message: "Review the project once more before saving.",
      });
      return;
    }

    await persistProject(withWalletContinuityAssertion(pendingSave, publicKey));
  }

  const amountPreview = validateInitialSupply(initialSupply);
  const canSaveReviewedProfile =
    review !== null &&
    acknowledgedProfileOnlySave &&
    matchesCurrentBuilderReview(review, draft, initialSupply, logoName) &&
    !logoError;
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
            Explore your configuration without connecting a wallet. A wallet
            is required to save a Project Profile, not to preview tokens.
          </p>
        </div>
        <span className="builder-anonymous-note">Preview: no wallet required</span>
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
                  disabled={saveState.status === "saving"}
                  aria-invalid={Boolean(errors.code)}
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
                  disabled={saveState.status === "saving"}
                  aria-invalid={Boolean(errors.displayName)}
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
                  disabled={saveState.status === "saving"}
                  aria-invalid={Boolean(errors.description)}
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

          <section className="draft-step" aria-labelledby="supply-step">
            <div className="step-heading">
              <span className="step-number">2</span>
              <div>
                <h3 id="supply-step">Initial token supply</h3>
                <p>
                  Choose the amount intended for the first issuance. This is not
                  a fixed lifetime cap.
                </p>
              </div>
            </div>
            <label className="field">
              <span>Initial supply (token units)</span>
              <input
                name="initialSupply"
                type="text"
                inputMode="decimal"
                value={initialSupply}
                  disabled={saveState.status === "saving"}
                  aria-invalid={Boolean(initialSupplyError)}
                onChange={(event) => updateInitialSupply(event.target.value)}
                placeholder="Example: 2500.5"
                autoComplete="off"
                aria-describedby={
                  initialSupplyError ? "supply-error" : "supply-help"
                }
              />
              {initialSupplyError ? (
                <small id="supply-error" className="field-error" role="alert">
                  {initialSupplyError}
                </small>
              ) : (
                <small id="supply-help">
                  Positive amount, up to seven decimal places. No tokens are
                  minted here.
                </small>
              )}
            </label>
            <p className="builder-boundary-note">
              Preview only: this amount is not yet saved with the Project
              Profile, included in an immutable issuance order, or issued on
              Stellar. Real issuance stays unavailable until the backend
              supports it safely.
            </p>
          </section>

          <section className="draft-step" aria-labelledby="brand-step">
            <div className="step-heading">
              <span className="step-number">3</span>
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
                disabled={saveState.status === "saving"}
                aria-invalid={Boolean(logoError)}
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
              <span className="step-number">4</span>
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
              <span className="step-number">5</span>
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
            <button
              type="submit"
              className="button button-secondary"
              disabled={saveState.status === "saving"}
            >
              Review configuration
            </button>
          </div>

          {review ? (
            <section className="draft-step" aria-labelledby="final-review-title">
              <div className="step-heading">
                <span className="step-number">6</span>
                <div>
                  <h3 id="final-review-title">Final draft review</h3>
                  <p>Review the exact configuration before saving project details.</p>
                </div>
              </div>
              <dl className="preview-facts" aria-label="Reviewed draft settings">
                <div><dt>Display name</dt><dd>{review.displayName}</dd></div>
                <div><dt>Asset code</dt><dd>{review.assetCode}</dd></div>
                <div><dt>Description</dt><dd>{review.description || "None"}</dd></div>
                <div><dt>Logo</dt><dd>{review.logoFileName ? `${review.logoFileName} (browser only)` : "None"}</dd></div>
                <div><dt>Selected initial supply (preview only)</dt><dd>{review.initialSupply} tokens</dd></div>
                <div><dt>Maximum lifetime supply</dt><dd>Not configured or guaranteed</dd></div>
                <div><dt>Target network</dt><dd>Stellar Testnet; no on-chain submission</dd></div>
                <div><dt>Issuer authority</dt><dd>Orrylo-operated Shared Issuer, not customer-owned; account not yet approved</dd></div>
                <div><dt>Distribution destination</dt><dd>Not selected or approved</dd></div>
                <div><dt>Fees</dt><dd>Not configured</dd></div>
                <div><dt>On-chain status</dt><dd>Not started; no transaction or confirmation</dd></div>
              </dl>
              <label className="field">
                <span>
                  <input
                    type="checkbox"
                    checked={acknowledgedProfileOnlySave}
                    disabled={saveState.status === "saving"}
                    onChange={(event) => setAcknowledgedProfileOnlySave(event.target.checked)}
                  />{" "}
                  I understand that saving creates only a managed Project Profile.
                  The selected initial supply and browser logo are NOT saved,
                  and no token is issued. Supply must be selected again once
                  secure issuance becomes available.
                </span>
              </label>
              <p className="builder-boundary-note" role="status">
                Reviewed browser draft. Saving a Project Profile is the only available
                next action; token issuance is disabled.
              </p>
            </section>
          ) : (
            <p className="builder-boundary-note" role="status">
              Browser draft only. Review this configuration before saving
              the Project Profile. Nothing has been submitted to Stellar.
            </p>
          )}
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
              <dt>Target network</dt>
              <dd>Stellar Testnet preview · issuance unavailable</dd>
            </div>
            <div>
              <dt>Initial supply (preview only)</dt>
              <dd>
                {amountPreview.valid
                  ? amountPreview.normalized
                  : initialSupply.trim()
                    ? "Invalid amount"
                    : "Not selected"}
              </dd>
            </div>
            <div>
              <dt>Supply authority</dt>
              <dd>Orrylo may retain future mint authority. No fixed lifetime supply is guaranteed.</dd>
            </div>
            <div>
              <dt>Issuer model</dt>
              <dd>Orrylo-operated Shared Issuer; not customer-owned</dd>
            </div>
            <div>
              <dt>Metadata home</dt>
              <dd>{SHARED_ASSET_DOMAIN}</dd>
            </div>
          </dl>

          <div className="execution-boundary">
            <span className="eyebrow">Project Profile only</span>
            <strong>Save name, code and description — not token supply.</strong>
            <p>
              Your wallet is used here only to prove who owns the Project
              Profile. Saving does not create a Stellar asset, sign a
              transaction, or publish TOML metadata. Your previewed initial
              supply is not yet stored with the managed project.
            </p>
            <button
              className="button button-primary"
              type="button"
              disabled={saveState.status === "saving" || !canSaveReviewedProfile}
              onClick={() => void handleSaveProject()}
            >
              {saveState.status === "saving"
                ? "Saving project…"
                : "Save Project Profile only"}
            </button>

            {saveState.status === "needs_wallet" ||
            saveState.status === "wallet_session_changed" ? (
              <div className="builder-wallet-boundary">
                <p>
                  {saveState.status === "wallet_session_changed"
                    ? "Your wallet session changed before the project could be saved. Reconnect or confirm the wallet that completed this save flow, then retry."
                    : "Connect with Albedo to claim this Project Profile. The selected initial supply is not sent to the server."}
                </p>
                <WalletAuthControl
                  connectLabel="Connect wallet & save"
                  onAuthenticated={(publicKey) =>
                    void continueAfterAuthentication(publicKey)
                  }
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
    case "wallet_session_changed":
      return "Your wallet session changed before saving. Reconnect or confirm the wallet that completed this save flow, then retry.";
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
