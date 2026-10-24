"use client";

import Image from "next/image";
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";

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
import {
  clearSettledMainnetPayment,
  readPendingMainnetPayment,
  withMainnetPaymentHandoff,
} from "../lib/projects/pending-mainnet-payment";
import { validateInitialSupply } from "../lib/validation/initial-supply";
import {
  type SharedAssetDraft,
  type SharedAssetDraftErrors,
  TOKEN_DESCRIPTION_MAX_LENGTH,
  validateSharedAssetDraft,
} from "../lib/validation/token";
import { WalletAuthControl } from "./wallet-auth-control";
import { WalletBalance } from "./wallet-balance";
import { CustomerTrustlineControl } from "./customer-trustline-control";
import { MainnetOrderControl, type MainnetOrderView as VerifiedMainnetOrder } from "./mainnet-order-control";

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
  | { status: "trustline_required" }
  | { status: "mainnet_order"; order: MainnetOrderView }
  | { status: "mainnet_paid"; order: MainnetOrderView }
  | { status: "mainnet_order_unavailable"; managePath: string }
  | { status: "persisting_intent" }
  | { status: "preparing_issuance" }
  | { status: "confirming" }
  | {
      status: "confirmed";
      transactionHash: string;
      managePath: string;
      assetCode: string;
      supply: string;
    }
  | { status: "reconciliation_required"; managePath: string }
  | { status: "needs_wallet" }
  | { status: "wallet_session_changed" }
  | { status: "failure"; message: string };

interface MainnetOrderView {
  orderId: string;
  projectId: string;
  treasury: string;
  issuer: string;
  memo: string;
  priceXlm: string;
  status: string;
  expiresAt: string;
  managePath: string;
}

export function CreateSharedTokenForm({ network = "testnet", mainnetActivationEnabled = false }: { network?: "testnet" | "public"; mainnetActivationEnabled?: boolean }) {
  const isMainnet = network === "public";
  const [draft, setDraft] = useState<SharedAssetDraft>(INITIAL_DRAFT);
  const [errors, setErrors] = useState<SharedAssetDraftErrors>({});
  const [initialSupply, setInitialSupply] = useState("");
  const [initialSupplyError, setInitialSupplyError] = useState<string | null>(
    null,
  );
  const [review, setReview] = useState<TokenBuilderReview | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const logoFileRef = useRef<File | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [mainnetPreview, setMainnetPreview] = useState<{ expectedHash: string; amount: string; memo: string; destination: string; source: string } | null>(null);
  const [mainnetPreviewError, setMainnetPreviewError] = useState<string | null>(null);
  const [mainnetPreviewBusy, setMainnetPreviewBusy] = useState(false);
  const [mainnetPayBusy, setMainnetPayBusy] = useState(false);
  const [mainnetPaymentMessage, setMainnetPaymentMessage] = useState<string | null>(null);
  const [verifiedMainnetOrder, setVerifiedMainnetOrder] = useState<VerifiedMainnetOrder | null>(null);
  const [trustlineStep, setTrustlineStep] = useState<{
    projectId: string;
    managePath: string;
    assetCode: string;
    supply: string;
  } | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const issuanceIdempotencyKeyRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<PendingManagedProjectSave | null>(null);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const logoReadVersionRef = useRef(0);
  const workflowRef = useRef<HTMLDivElement>(null);

  function invalidateReview() {
    revisionRef.current += 1;
    setReview(null);
    setSaveState({ status: "idle" });
    setTrustlineStep(null);
    setMainnetPreview(null);
    setMainnetPreviewError(null);
    setVerifiedMainnetOrder(null);
    idempotencyKeyRef.current = null;
    issuanceIdempotencyKeyRef.current = null;
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
    logoFileRef.current = null;

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

    logoFileRef.current = file;
    const reader = new FileReader();

    reader.onload = () => {
      if (
        readVersion === logoReadVersionRef.current &&
        typeof reader.result === "string"
      ) {
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
      return;
    }
    setDraft(project.normalized);
    setReview(checked.review);
    setSaveState({ status: "idle" });
  }

  async function handleSaveProject() {
    if (
      !review ||
      !matchesCurrentBuilderReview(review, draft, initialSupply, logoName) ||
      logoError
    ) {
      setSaveState({
        status: "failure",
        message: "Review the exact asset configuration before creating it.",
      });
      return;
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    const prepared = prepareManagedProjectSave(
      draft,
      idempotencyKeyRef.current,
      network,
    );
    setErrors(prepared.errors);
    if (!prepared.ok) {
      setReview(null);
      setSaveState({
        status: "failure",
        message: "Review the highlighted asset details before saving.",
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

      if (logoFileRef.current) {
        const logoData = new FormData();
        logoData.set("logo", logoFileRef.current);
        const logoResponse = await fetch(`/api/projects/${result.projectId}/logo`, {
          method: "POST",
          credentials: "same-origin",
          body: logoData,
        });
        if (!logoResponse.ok) {
          setSaveState({
            status: "failure",
            message: `Project saved, but logo upload failed. Open ${result.managePath} to recover; no token issuance was started.`,
          });
          return;
        }
      }

      if (
        !review ||
        !matchesCurrentBuilderReview(review, draft, initialSupply, logoName)
      ) {
        window.location.assign(result.managePath);
        return;
      }
      if (isMainnet) {
        await createMainnetOrder(result.projectId, result.managePath, review.initialSupply);
        return;
      }
      setTrustlineStep({
        projectId: result.projectId,
        managePath: result.managePath,
        assetCode: review.assetCode,
        supply: review.initialSupply,
      });
      setSaveState({ status: "trustline_required" });
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

  async function createMainnetOrder(projectId: string, managePath: string, supply: string) {
    try {
      const response = await fetch("/api/mainnet/orders", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, initialSupply: supply }),
      });
      const result = await readJson<{ ok: boolean; orderId: string; treasury: string; issuer: string; memo: string; priceXlm: string; status: string; expiresAt: string }>(response);
      if (!response.ok || !result?.ok) {
        setSaveState({ status: "mainnet_order_unavailable", managePath });
        return;
      }
      setSaveState({ status: "mainnet_order", order: {
        orderId: result.orderId, projectId, treasury: result.treasury,
        issuer: result.issuer, memo: result.memo, priceXlm: result.priceXlm,
        status: result.status, expiresAt: result.expiresAt, managePath,
      } });
    } catch {
      setSaveState({ status: "mainnet_order_unavailable", managePath });
    }
  }

  async function loadVerifiedMainnetOrder(order: MainnetOrderView) {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(order.projectId)}/mainnet`, { credentials: "same-origin", cache: "no-store" });
      const data = await readJson<{ok: boolean; order: VerifiedMainnetOrder}>(response);
      if (!response.ok || !data?.ok || data.order.status === "awaiting_payment") {
        setMainnetPaymentMessage("Payment state is not yet verified. Check the saved payment hash; do not pay again.");
        return;
      }
      setVerifiedMainnetOrder(data.order);
    } catch {
      setMainnetPaymentMessage("Could not load the next step. Your paid order is saved; resume from your project.");
    }
  }

  async function previewMainnetPayment(order: MainnetOrderView) {
    if (mainnetPreviewBusy) return;
    setMainnetPreviewBusy(true);
    setMainnetPreview(null);
    setMainnetPreviewError(null);
    try {
      const response = await fetch(
        `/api/mainnet/orders/${encodeURIComponent(order.orderId)}/prepare`,
        { method: "POST", credentials: "same-origin", cache: "no-store" },
      );
      const result = await readJson<{
        ok: boolean;
        expectedHash: string;
        amount: string;
        memo: string;
        destination: string;
        source: string;
        network: string;
      }>(response);
      if (!response.ok || !result?.ok) {
        setMainnetPreviewError("Payment preview is not enabled yet. No wallet transaction was started.");
        return;
      }
      if (result.network !== "public" ||
          result.amount !== "10.0000000" ||
          result.memo !== order.memo ||
          result.destination !== order.treasury ||
          !/^[0-9a-f]{64}$/.test(result.expectedHash)) {
        setMainnetPreviewError("The payment preview did not match your saved order.");
        return;
      }
      setMainnetPreview({
        expectedHash: result.expectedHash,
        amount: result.amount,
        memo: result.memo,
        destination: result.destination,
        source: result.source,
      });
    } catch {
      setMainnetPreviewError("Payment preview is temporarily unavailable. No funds were moved.");
    } finally {
      setMainnetPreviewBusy(false);
    }
  }

  async function reconcileMainnetPayment(order: MainnetOrderView) {
    const pending = readPendingMainnetPayment(window.localStorage, order.orderId);
    if (pending.kind !== "pending") {
      setMainnetPaymentMessage("No recoverable payment hash was found in this browser. Do not make another payment until the order is checked.");
      return;
    }
    setMainnetPayBusy(true);
    try {
      const response = await fetch(`/api/mainnet/orders/${encodeURIComponent(order.orderId)}/payment`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionHash: pending.value.transactionHash }),
      });
      const result = await readJson<{ok: boolean; status?: string}>(response);
      if (response.ok && result?.ok && (result.status === "paid" || result.status === "already_paid")) {
        clearSettledMainnetPayment(window.localStorage, order.orderId, pending.value.transactionHash);
        setSaveState({status: "mainnet_paid", order});
        setMainnetPaymentMessage("Payment confirmed. Preparing the next step…");
        try {
          const next = await fetch(`/api/projects/${encodeURIComponent(order.projectId)}/mainnet`, { credentials: "same-origin", cache: "no-store" });
          const data = await readJson<{ok: boolean; order: VerifiedMainnetOrder}>(next);
          if (!next.ok || !data?.ok) throw new Error("state_unavailable");
          setVerifiedMainnetOrder(data.order);
        } catch {
          setMainnetPaymentMessage("Payment is verified, but the next step could not load. Use your saved project to resume safely. Do not pay again.");
        }
      } else {
        setMainnetPaymentMessage("Payment not yet confirmed or requires reconciliation. Orrylo will not request another payment; retry verification later.");
      }
    } catch {
      setMainnetPaymentMessage("Network result is unknown. Your exact payment hash is retained; do not pay again.");
    } finally {
      setMainnetPayBusy(false);
    }
  }

  async function payMainnetOrder(order: MainnetOrderView) {
    if (mainnetPayBusy) return;
    setMainnetPayBusy(true);
    setMainnetPaymentMessage(null);
    try {
      if (readPendingMainnetPayment(window.localStorage, order.orderId).kind !== "none") {
        setMainnetPaymentMessage("A payment attempt is already saved. Reconcile that exact hash before any new wallet action.");
        return;
      }
      const response = await fetch(`/api/mainnet/orders/${encodeURIComponent(order.orderId)}/prepare`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
      });
      const plan = await readJson<{ok: boolean; xdr: string; expectedHash: string; source: string; destination: string; amount: string; memo: string; network: string}>(response);
      if (!response.ok || !plan?.ok) {
        setMainnetPaymentMessage("Customer payment is not enabled yet. No wallet transaction was started.");
        return;
      }
      if (plan.network !== "public" || plan.amount !== "10.0000000" ||
          plan.destination !== order.treasury || plan.memo !== order.memo ||
          !/^G[A-Z2-7]{55}$/.test(plan.source) ||
          !/^[0-9a-f]{64}$/.test(plan.expectedHash) || !plan.xdr) {
        setMainnetPaymentMessage("The payment transaction did not match this order. No wallet transaction was started.");
        return;
      }
      const handedOff = await withMainnetPaymentHandoff(
        window.localStorage,
        {version: 1, network: "public", orderId: order.orderId, source: plan.source,
         transactionHash: plan.expectedHash, unsignedXdr: plan.xdr},
        navigator.locks,
        async () => {
          const { default: albedo } = await import("@albedo-link/intent");
          const outcome = await albedo.tx({
            xdr: plan.xdr, pubkey: plan.source, network: "public", submit: true,
            description: "Pay exactly 10 XLM to Orrylo for this saved asset order",
          });
          if (outcome.tx_hash?.toLowerCase() !== plan.expectedHash || outcome.network !== "public") {
            throw new Error("unknown_wallet_outcome");
          }
        },
      );
      if (handedOff) {
        await reconcileMainnetPayment(order);
      } else {
        setMainnetPaymentMessage("Another tab or an existing pending payment prevents a new wallet request.");
      }
    } catch {
      setMainnetPaymentMessage("Payment submission may be unknown. The saved hash must be reconciled; do not pay again.");
    } finally {
      setMainnetPayBusy(false);
    }
  }

  async function persistIntentAndExecute(
    projectId: string,
    managePath: string,
    assetCode: string,
    supply: string,
  ) {
    issuanceIdempotencyKeyRef.current ??= crypto.randomUUID();
    setTrustlineStep(null);
    setSaveState({ status: "persisting_intent" });
    try {
      const intentResponse = await fetch(
        `/api/projects/${projectId}/issuance`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: issuanceIdempotencyKeyRef.current,
            expectedAssetCode: assetCode,
            initialSupply: supply,
          }),
        },
      );
      const intentResult = await readJson<{
        ok: true;
        issuance: { requestId: string };
      }>(intentResponse);
      if (!intentResponse.ok || !intentResult?.ok) {
        setSaveState({
          status: "failure",
          message:
            "The Project Profile was saved, but the immutable asset intent was not confirmed. Open the project to recover from server state.",
        });
        return;
      }

      setSaveState({ status: "preparing_issuance" });
      const executionResponse = await fetch(
        `/api/projects/${projectId}/issuance/execution`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: intentResult.issuance.requestId }),
        },
      );
      const executionResult = await readJson<{
        ok: true;
        execution:
          | { status: "confirmed"; transactionHash: string }
          | { status: "preparing_issuance" }
          | { status: "confirming"; transactionHash: string }
          | { status: "reconciliation_required"; transactionHash: string }
          | { status: "failed_before_submission"; failureCode: string };
      }>(executionResponse);
      if (!executionResponse.ok || !executionResult?.ok) {
        window.location.assign(managePath);
        return;
      }
      if (executionResult.execution.status === "confirmed") {
        setSaveState({
          status: "confirmed",
          transactionHash: executionResult.execution.transactionHash,
          managePath,
          assetCode,
          supply,
        });
        return;
      }
      if (executionResult.execution.status === "preparing_issuance") {
        setSaveState({ status: "preparing_issuance" });
        window.location.assign(managePath);
        return;
      }
      if (executionResult.execution.status === "reconciliation_required") {
        setSaveState({ status: "reconciliation_required", managePath });
        return;
      }
      if (executionResult.execution.status === "confirming") {
        setSaveState({ status: "confirming" });
        window.location.assign(managePath);
        return;
      }
      setSaveState({
        status: "failure",
        message: `Asset creation stopped before submission (${executionResult.execution.failureCode}). No automatic retry was attempted.`,
      });
    } catch {
      window.location.assign(managePath);
    }
  }

  async function continueAfterAuthentication(publicKey: string) {
    const pendingSave = pendingSaveRef.current;

    if (
      !pendingSave ||
      !review ||
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
  const canCreateToken =
    review !== null &&
    matchesCurrentBuilderReview(review, draft, initialSupply, logoName) &&
    !logoError;
  const isWorking = [
    "saving",
    "trustline_required",
    "mainnet_order",
    "persisting_intent",
    "preparing_issuance",
    "confirming",
  ].includes(saveState.status);

  const flowLabels = isMainnet
    ? ["Design", "Review & connect", "Pay", "Prepare wallet", "Verify"]
    : ["Design", "Review & connect", "Prepare wallet", "Verify"];
  const stage = saveState.status === "confirmed" ? (isMainnet ? 4 : 3)
    : ["persisting_intent", "preparing_issuance", "confirming", "reconciliation_required"].includes(saveState.status) ? (isMainnet ? 4 : 3)
    : ["trustline_required", "mainnet_paid"].includes(saveState.status) ? (isMainnet ? 3 : 2)
    : ["mainnet_order", "mainnet_order_unavailable"].includes(saveState.status) ? 2
    : review ? 1 : 0;
  useEffect(() => {
    if (saveState.status !== "idle") workflowRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  }, [saveState.status]);
  const previewCode = draft.code.trim().toUpperCase() || "ASSET";
  const previewName = draft.displayName.trim() || "Your asset";
  const previewDescription =
    draft.description.trim() ||
    "Add a short description to show people what your asset is for.";

  return (
    <form className="form-card guided-form" data-creation-stage={review ? "review" : "design"} data-workflow-status={saveState.status} onSubmit={handleSubmit} noValidate>
      <section className="creation-progress" aria-label="Asset creation progress">
        <div className="creation-progress-top"><strong>Create your asset</strong><span>Step {stage + 1} of {flowLabels.length}</span></div>
        <ol className="creation-progress-list">{flowLabels.map((label, index) => (
          <li key={label} className={index===stage ? "is-current" : index<stage ? "is-complete" : ""} aria-current={index===stage ? "step" : undefined}>
            <span aria-hidden="true">{index<stage ? "✓" : index+1}</span><small>{label}</small>
          </li>
        ))}</ol>
        <p className="creation-progress-caption" role="status">
          {saveState.status==="trustline_required" ? "Next: prepare your wallet to receive this asset. No other page needed."
            : saveState.status==="mainnet_paid" ? "Payment verified. Continue wallet preparation without paying again."
            : saveState.status==="mainnet_order" ? "Your project is saved. Authorize payment only when enabled."
            : saveState.status==="confirmed" ? "Confirmed on Stellar."
            : review ? "Review details and continue. Project saving is handled automatically."
            : "Enter your asset details. No wallet required to preview."}
        </p>
      </section>
      <div className="builder-heading">
        <div>
          <span className="eyebrow">Interactive asset builder</span>
          <h2>Shape the asset you want Orrylo to create.</h2>
          <p>
            Explore your configuration without connecting a wallet. A wallet is
            required to save a Project Profile, not to preview assets.
          </p>
        </div>
        <WalletBalance network={network} />
      </div>

      <div className="draft-layout">
        <div className="draft-fields">
          <section className="draft-step" aria-labelledby="identity-step">
            <div className="step-heading">
              <span className="step-number">1</span>
              <div>
                <h3 id="identity-step">Asset identity</h3>
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
                  disabled={isWorking}
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
                  disabled={isWorking}
                  aria-invalid={Boolean(errors.displayName)}
                  onChange={(event) =>
                    updateField("displayName", event.target.value)
                  }
                  placeholder="My Asset"
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
                disabled={isWorking}
                aria-invalid={Boolean(errors.description)}
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
                placeholder="What does your asset represent or enable?"
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
                <h3 id="supply-step">Initial asset supply</h3>
                <p>
                  Choose the amount intended for the first issuance. This is not
                  a fixed lifetime cap.
                </p>
              </div>
            </div>
            <label className="field">
              <span>Initial supply (asset units)</span>
              <input
                name="initialSupply"
                type="text"
                inputMode="decimal"
                value={initialSupply}
                disabled={isWorking}
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
                  Positive amount, up to seven decimal places. No assets are
                  minted here.
                </small>
              )}
            </label>
            <p className="builder-boundary-note">
              This amount becomes immutable only after the final review and
              Create Asset action. It is never inferred from browser state.
            </p>
          </section>

          <section className="draft-step" aria-labelledby="brand-step">
            <div className="step-heading">
              <span className="step-number">3</span>
              <div>
                <h3 id="brand-step">Logo &amp; presentation</h3>
                <p>
                  Add a local image to make the asset preview feel like your
                  project. Your logo will be uploaded and saved with the project before issuance.
                </p>
              </div>
            </div>

            <label className="field logo-field">
              <span>Asset logo</span>
              <input
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoChange}
                disabled={isWorking}
                aria-invalid={Boolean(logoError)}
                aria-describedby={logoError ? "logo-error" : "logo-help"}
              />
              {logoError ? (
                <small id="logo-error" className="field-error">
                  {logoError}
                </small>
              ) : (
                <small id="logo-help">
                  PNG, JPEG, or WebP · up to 2 MB · saved when you create the project
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
            {review ? <button type="button" className="button button-secondary" onClick={invalidateReview} disabled={isWorking}>Edit details</button> : null}
            <button
              type="submit"
              className="button button-secondary"
              disabled={isWorking}
            >
              {review ? "Update review" : "Review & continue"}
            </button>
          </div>

          {review ? (
            <section
              className="draft-step"
              aria-labelledby="final-review-title"
            >
              <div className="step-heading">
                <span className="step-number">6</span>
                <div>
                  <h3 id="final-review-title">Final draft review</h3>
                  <p>
                    Review the exact configuration before creating the asset.
                  </p>
                </div>
              </div>
              <dl
                className="preview-facts"
                aria-label="Reviewed draft settings"
              >
                <div>
                  <dt>Display name</dt>
                  <dd>{review.displayName}</dd>
                </div>
                <div>
                  <dt>Asset code</dt>
                  <dd>{review.assetCode}</dd>
                </div>
                <div>
                  <dt>Description</dt>
                  <dd>{review.description || "None"}</dd>
                </div>
                <div>
                  <dt>Logo</dt>
                  <dd>
                    {review.logoFileName
                      ? `${review.logoFileName} (uploaded on save)`
                      : "None"}
                  </dd>
                </div>
                <div>
                  <dt>Exact initial supply</dt>
                  <dd>{review.initialSupply} assets</dd>
                </div>
                <div>
                  <dt>Maximum lifetime supply</dt>
                  <dd>Not configured or guaranteed</dd>
                </div>
                <div>
                  <dt>Target network</dt>
                  <dd>{isMainnet ? "Stellar Mainnet" : "Stellar Testnet only"}</dd>
                </div>
                <div>
                  <dt>Issuer authority</dt>
                  <dd>
                    Server-approved Orrylo Shared Issuer; not customer-owned
                  </dd>
                </div>
                <div>
                  <dt>Distribution destination</dt>
                  <dd>Authenticated owner wallet</dd>
                </div>
                <div>
                  <dt>Fees</dt>
                  <dd>{isMainnet ? "10 XLM service price + separate Stellar fees/reserve" : "Server-authoritative Testnet fee"}</dd>
                </div>
                <div>
                  <dt>On-chain status</dt>
                  <dd>Not started; no transaction or confirmation</dd>
                </div>
              </dl>
              <p className="builder-boundary-note" role="status">
                {isMainnet
                  ? "Saving creates a project and prepares a 10 XLM Mainnet order. Payment and asset issuance remain unavailable until activation."
                  : "Create Asset saves the Project Profile and immutable issuance intent as one journey, then starts the reviewed Testnet path."}
              </p>
            </section>
          ) : (
            <p className="builder-boundary-note" role="status">
              Browser draft only. Review this configuration before saving the
              Project Profile. Nothing has been submitted to Stellar.
            </p>
          )}
        </div>

        <aside className="draft-preview" aria-label="Live asset preview">
          <div className="preview-header">
            <div>
              <span className="eyebrow">Live asset preview</span>
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
              <dd>{isMainnet ? "Stellar Mainnet" : "Stellar Testnet"}</dd>
            </div>
            <div>
              <dt>Initial supply</dt>
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
              <dd>
                Orrylo may retain future mint authority. No fixed lifetime
                supply is guaranteed.
              </dd>
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

          <div ref={workflowRef} className="execution-boundary creation-active-step" tabIndex={-1}>
            <span className="eyebrow">Your next step</span>
            <strong>{saveState.status==="trustline_required" ? "Prepare your wallet" : saveState.status==="mainnet_order" ? "Review and authorize payment" : saveState.status==="mainnet_paid" ? "Payment confirmed — continue" : saveState.status==="confirmed" ? "Your asset is ready" : review ? "Save and continue" : "Review asset details first"}</strong>
            <p>
              Your Albedo-authenticated wallet becomes the owner and receiving
              destination. Issuer, network, fee and ledger status remain
              server-authoritative.
            </p>
            <button
              className="button button-primary"
              type="button"
              disabled={isWorking || !canCreateToken}
              onClick={() => void handleSaveProject()}
            >
              {saveState.status === "saving"
                ? "Validating / saving…"
                : saveState.status === "mainnet_order"
                  ? "Order prepared"
                  : saveState.status === "trustline_required"
                  ? "Trustline approval required…"
                  : saveState.status === "persisting_intent"
                    ? "Saving immutable intent…"
                    : saveState.status === "preparing_issuance"
                      ? "Preparing issuance…"
                      : saveState.status === "confirming"
                        ? "Confirming…"
                        : isMainnet ? "Continue to payment" : "Continue to wallet preparation"}
            </button>

            {saveState.status === "needs_wallet" ||
            saveState.status === "wallet_session_changed" ? (
              <div className="builder-wallet-boundary">
                <p>
                  {saveState.status === "wallet_session_changed"
                    ? "Your wallet session changed before the project could be saved. Reconnect or confirm the wallet that completed this save flow, then retry."
                    : isMainnet
                      ? "Connect with Albedo to own your project and prepare the Mainnet order."
                      : "Connect with Albedo to own this project and continue the reviewed Create Asset request."}
                </p>
                <WalletAuthControl
                  connectLabel={isMainnet ? "Connect wallet & save project" : "Connect wallet & create asset"}
                  network={network}
                  onAuthenticated={(publicKey) =>
                    void continueAfterAuthentication(publicKey)
                  }
                />
              </div>
            ) : null}

            {isMainnet && saveState.status === "mainnet_order" ? (
              <section aria-label="Mainnet payment order" className="draft-step">
                <h3>Review your payment</h3>
                <p>Your project and payment order are saved. Payment opens only when the Mainnet launch gates are explicitly enabled. Do not send funds manually.</p>
                <dl className="preview-facts">
                  <div><dt>Price</dt><dd>{saveState.order.priceXlm} XLM</dd></div>
                  <div><dt>Treasury (receive-only)</dt><dd><code>{saveState.order.treasury}</code></dd></div>
                  <div><dt>Order memo</dt><dd><code>{saveState.order.memo}</code></dd></div>
                  <div><dt>Status</dt><dd>{saveState.order.status}</dd></div>
                </dl>
                <p><a href={saveState.order.managePath}>Open saved project</a></p>
                <button type="button" className="button button-secondary"
                  disabled={mainnetPreviewBusy}
                  onClick={() => {
                    if (saveState.status === "mainnet_order") {
                      void previewMainnetPayment(saveState.order);
                    }
                  }}>
                  {mainnetPreviewBusy ? "Preparing preview…" : "Preview exact payment (no signing)"}
                </button>
                {mainnetPreviewError ? <p role="status">{mainnetPreviewError}</p> : null}
                {mainnetPreview ? (
                  <dl className="preview-facts" aria-label="Read-only payment transaction preview">
                    <div><dt>Payment source</dt><dd><code>{mainnetPreview.source}</code></dd></div>
                    <div><dt>Amount</dt><dd>{mainnetPreview.amount} XLM</dd></div>
                    <div><dt>Destination</dt><dd><code>{mainnetPreview.destination}</code></dd></div>
                    <div><dt>Memo</dt><dd><code>{mainnetPreview.memo}</code></dd></div>
                    <div><dt>Unsigned transaction hash</dt><dd><code>{mainnetPreview.expectedHash}</code></dd></div>
                    <div><dt>Safety</dt><dd>No wallet opened, no signature requested, and no transaction submitted.</dd></div>
                  </dl>
                ) : null}
                <div className="builder-actions">
                  <button type="button" className="button" disabled={mainnetPayBusy}
                    onClick={() => void payMainnetOrder(saveState.order)}>
                    {mainnetPayBusy ? "Opening or verifying wallet…" : "Pay 10 XLM with Albedo"}
                  </button>
                  <button type="button" className="button button-secondary" disabled={mainnetPayBusy}
                    onClick={() => void reconcileMainnetPayment(saveState.order)}>
                    Verify saved payment hash
                  </button>
                </div>
                {mainnetPaymentMessage ? <p role="status">{mainnetPaymentMessage}</p> : null}
              </section>
            ) : null}
            {isMainnet && saveState.status === "mainnet_paid" ? (
              <section className="creation-resume-panel" role="status">
                {verifiedMainnetOrder ? (
                  <MainnetOrderControl initialOrder={verifiedMainnetOrder} activationEnabled={mainnetActivationEnabled} onIssued={() => window.location.assign(saveState.order.managePath)} />
                ) : (
                  <>
                    <h3>Payment confirmed</h3>
                    <p>{mainnetPaymentMessage ?? "Loading wallet preparation…"}</p>
                    <button type="button" className="button button-secondary" onClick={() => void loadVerifiedMainnetOrder(saveState.order)}>Reload next step</button>
                    <a href={saveState.order.managePath}>Recover from saved project</a>
                  </>
                )}
              </section>
            ) : null}
            {isMainnet && saveState.status === "mainnet_order_unavailable" ? (
              <p role="status">Your project was saved, but Mainnet orders are not yet available. No payment was requested. <a href={saveState.managePath}>Open saved project</a>.</p>
            ) : null}
            {trustlineStep && saveState.status === "trustline_required" ? (
              <CustomerTrustlineControl
                key={`${trustlineStep.projectId}:${trustlineStep.supply}`}
                projectId={trustlineStep.projectId}
                assetCode={trustlineStep.assetCode}
                amount={trustlineStep.supply}
                onConfirmed={() =>
                  persistIntentAndExecute(
                    trustlineStep.projectId,
                    trustlineStep.managePath,
                    trustlineStep.assetCode,
                    trustlineStep.supply,
                  )
                }
              />
            ) : null}

            {saveState.status === "failure" ? (
              <p className="field-error" role="alert">
                {saveState.message}
              </p>
            ) : null}

            {saveState.status === "confirmed" ? (
              <p role="status">
                Confirmed on Stellar Testnet with durable exact-hash evidence:{" "}
                <code>{saveState.transactionHash}</code>
                <span>
                  {" "}
                  · {saveState.supply} {saveState.assetCode}
                </span>
                <a href={saveState.managePath}> Open asset project</a>
              </p>
            ) : null}

            {saveState.status === "reconciliation_required" ? (
              <p role="alert">
                Submission outcome is ambiguous. Orrylo will not resubmit.{" "}
                <a href={saveState.managePath}>Open the saved project</a> to
                reconcile the exact transaction hash.
              </p>
            ) : null}

            <small className="builder-boundary-note">
              Success appears only after authoritative durable confirmation.
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
      return "Review the asset details and try saving again.";
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
