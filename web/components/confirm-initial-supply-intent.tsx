"use client";

import { useRef, useState, type FormEvent } from "react";

import { validateInitialSupply } from "../lib/validation/initial-supply";

/**
 * Only commits an application issuance intent. Signing/submission remain
 * unavailable even after the server reports a committed fingerprint.
 */
export function ConfirmInitialSupplyIntent({
  projectId,
  assetCode,
  ownerPublicKey,
  available,
}: {
  projectId: string;
  assetCode: string;
  ownerPublicKey: string;
  available: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    fingerprint: string;
    amount: string;
    requestId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const revision = useRef(0);

  const validated = validateInitialSupply(amount);
  const isCurrent = reviewed !== null && validated.valid &&
    validated.stroops.toString() === reviewed;

  function edit(value: string) {
    revision.current++;
    keyRef.current = null;
    setAmount(value);
    setReviewed(null);
    setError(null);
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validated.valid) {
      setReviewed(null);
      setError(validated.error);
      return;
    }
    setReviewed(validated.stroops.toString());
  }

  async function confirm() {
    if (!available || !isCurrent || !validated.valid || busyRef.current || confirmed) return;
    const amountAtReview = validated.normalized;
    const revisionAtRequest = revision.current;
    const idempotencyKey = keyRef.current ?? crypto.randomUUID();
    keyRef.current = idempotencyKey;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/issuance`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedAssetCode: assetCode,
          initialSupply: amountAtReview,
          idempotencyKey,
        }),
      });
      const result: unknown = await response.json();
      if (revision.current !== revisionAtRequest) return;
      if (response.ok && isCommittedIntentResponse(result, amountAtReview)) {
        setConfirmed({
          fingerprint: result.issuance.completeIntent.fingerprint,
          amount: result.issuance.completeIntent.initialSupply,
          requestId: result.issuance.requestId,
        });
        return;
      }
      setError("Intent not confirmed. Check your wallet session, amount and project status. Retry preserves this request key.");
    } catch {
      if (revision.current === revisionAtRequest) {
        setError("Request outcome is unknown. Retry the same reviewed amount; do not start another order.");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!available) {
    return <p role="status">Intent confirmation is unavailable until the Testnet Shared Issuer is independently approved and configured. No token has been issued.</p>;
  }
  if (confirmed) {
    return (
      <div role="status">
        <p>Immutable application intent committed for {confirmed.amount} tokens. No transaction has been submitted or confirmed.</p>
        <p>Request ID: <code>{confirmed.requestId}</code></p>
        <p>Intent fingerprint: <code>{confirmed.fingerprint}</code></p>
      </div>
    );
  }
  return (
    <form onSubmit={review} className="draft-step" noValidate>
      <h3>Review and confirm initial issuance intent</h3>
      <p>The amount is re-entered here because browser previews are not saved with Project Profiles. This action reserves an identity and persists an immutable intent only.</p>
      <label className="field">
        <span>Selected initial supply (token units)</span>
        <input type="text" inputMode="decimal" value={amount}
          onChange={(e) => edit(e.target.value)}
          disabled={busy} aria-invalid={Boolean(error)} aria-describedby="intent-amount-help"/>
        <small id="intent-amount-help">Positive amount, up to seven decimal places. No default, cap or mint operation.</small>
      </label>
      {!isCurrent ? (
        <button type="submit" className="button button-secondary" disabled={busy}>Review exact intent</button>
      ) : (
        <div>
          <dl className="preview-facts" aria-label="Immutable intent review">
            <div><dt>Network</dt><dd>Stellar Testnet only</dd></div>
            <div><dt>Asset code</dt><dd>{assetCode}</dd></div>
            <div><dt>Destination (authenticated owner)</dt><dd><code>{ownerPublicKey}</code></dd></div>
            <div><dt>Initial supply</dt><dd>{validated.valid ? validated.normalized : ""}</dd></div>
            <div><dt>Maximum supply</dt><dd>Not guaranteed</dd></div>
            <div><dt>Shared Issuer</dt><dd>Orrylo controlled, server-approved identity only; no customer-exclusive authority</dd></div>
            <div><dt>Execution</dt><dd>Unavailable — intent only</dd></div>
          </dl>
          <button className="button button-secondary" type="button"
            disabled={busy || !isCurrent} onClick={() => void confirm()}>
            {busy ? "Saving immutable intent…" : "Confirm immutable issuance intent"}
          </button>
        </div>
      )}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </form>
  );
}

function isCommittedIntentResponse(value: unknown, amount: string): value is {
  issuance: {
    requestId: string;
    completeIntent: { fingerprint: string; initialSupply: string };
  };
} {
  if (!value || typeof value !== "object") return false;
  const root = value as Record<string, unknown>;
  if (root.ok !== true || !root.issuance || typeof root.issuance !== "object") return false;
  const issuance = root.issuance as Record<string, unknown>;
  if (!issuance.completeIntent || typeof issuance.completeIntent !== "object") return false;
  const intent = issuance.completeIntent as Record<string, unknown>;
  return typeof issuance.requestId === "string" &&
    typeof intent.fingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(intent.fingerprint) &&
    typeof intent.initialSupply === "string" &&
    validateInitialSupply(intent.initialSupply).valid &&
    validateInitialSupply(amount).valid &&
    (validateInitialSupply(intent.initialSupply) as { valid: true; stroops: bigint }).stroops ===
    (validateInitialSupply(amount) as { valid: true; stroops: bigint }).stroops;
}
