"use client";

import { useEffect, useRef, useState } from "react";

import { classifyWalletIntentError } from "../lib/wallet/errors";
import {
  clearResolvedCustomerTrustline,
  pendingCustomerTrustlineKey,
  readPendingCustomerTrustline,
  storePendingCustomerTrustline,
  type PendingCustomerTrustline,
} from "../lib/projects/pending-customer-trustline";

export interface CustomerTrustlineState {
  status: "ready" | "signature_required";
  network: "testnet";
  issuerPublicKey: string;
  destinationPublicKey: string;
  assetCode: string;
  amount: string;
  issuerFeeStroops: string;
  customerFeeStroops: string;
  customerFeeCapStroops: string;
  additionalReserveStroops: string;
  unsignedXdr?: string;
  transactionHash?: string;
  validUntil?: number;
}

export function CustomerTrustlineControl({
  projectId,
  assetCode,
  amount,
  onConfirmed,
}: {
  projectId: string;
  assetCode: string;
  amount: string;
  onConfirmed: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<CustomerTrustlineState | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const finishing = useRef(false);


  function matchesReview(value: CustomerTrustlineState): boolean {
    return (
      value.network === "testnet" &&
      value.assetCode === assetCode &&
      value.amount === amount &&
      /^G[A-Z2-7]{55}$/.test(value.destinationPublicKey) &&
      /^G[A-Z2-7]{55}$/.test(value.issuerPublicKey)
    );
  }

  async function inspectFresh(): Promise<CustomerTrustlineState> {
    const response = await fetch(
      `/api/projects/${projectId}/issuance/trustline?amount=${encodeURIComponent(amount)}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    const result = await readResponse(response);
    if (!response.ok || !result?.ok || !matchesReview(result.trustline)) {
      throw new Error(result?.code ?? "fresh_readiness_unavailable");
    }
    return result.trustline;
  }

  async function loadReadiness() {
    if (busy.current || finishing.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      // Reconcile the persisted exact hash before any ordinary readiness
      // refresh. A not-ready trustline is NEVER proof of failed submission.
      const previous = readPendingCustomerTrustline(window.localStorage, projectId);
      if (previous.kind === "blocked") {
        setPlan(null);
        setPending(true);
        setError(
          "Saved ChangeTrust evidence is inaccessible or malformed. Signing stays blocked until it can be securely reconciled.",
        );
        return;
      }
      if (previous.kind === "pending") {
        setPlan(null);
        setPending(true);
        const unresolved = previous.value;
        if (
          unresolved.assetCode !== assetCode ||
          unresolved.network !== "testnet"
        ) {
          setError("An earlier ChangeTrust for this project must be reconciled before another signing action.");
          return;
        }
        const response = await fetch(
          `/api/projects/${projectId}/issuance/trustline`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: unresolved.amount,
              transactionHash: unresolved.transactionHash,
              unsignedXdr: unresolved.unsignedXdr,
            }),
          },
        );
        const result = await readReconciliation(response);
        if (!response.ok || !result?.ok || result.reconciliation.status === "pending") {
          setError(
            "The exact ChangeTrust transaction is unresolved. No new signature is permitted; check the same transaction again.",
          );
          return;
        }
        // The server has either established current authorized capacity or
        // terminal exact-hash evidence. A fresh plan must be available before
        // another signing action can be shown.
        let fresh: CustomerTrustlineState;
        if (
          result.reconciliation.status === "ready" &&
          unresolved.amount === amount &&
          result.reconciliation.trustline &&
          matchesReview(result.reconciliation.trustline)
        ) {
          fresh = result.reconciliation.trustline;
        } else {
          fresh = await inspectFresh();
        }
        if (
          fresh.destinationPublicKey !== unresolved.destinationPublicKey ||
          fresh.issuerPublicKey !== unresolved.issuerPublicKey ||
          !clearResolvedCustomerTrustline(
            window.localStorage,
            projectId,
            unresolved.transactionHash,
          )
        ) {
          setError("Previous ChangeTrust evidence could not be safely released.");
          return;
        }
        setPlan(fresh);
        setPending(false);
        return;
      }

      const fresh = await inspectFresh();
      setPlan(fresh);
      setPending(false);
    } catch {
      setPlan(null);
      const prior = readPendingCustomerTrustline(window.localStorage, projectId);
      setPending(prior.kind !== "none");
      setError(
        prior.kind === "none"
          ? "Could not verify the exact customer trustline. No issuance was started."
          : "The exact prior ChangeTrust remains unresolved. No additional signature is allowed.",
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void loadReadiness());
    const onStorage = (event: StorageEvent) => {
      if (event.key === pendingCustomerTrustlineKey(projectId)) {
        queueMicrotask(() => void loadReadiness());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // The control is remounted for a different project or reviewed amount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, amount, assetCode]);

  async function approveTrustline() {
    if (
      busy.current ||
      pending ||
      !plan?.unsignedXdr ||
      !plan.transactionHash ||
      plan.status !== "signature_required" ||
      !plan.validUntil ||
      readPendingCustomerTrustline(window.localStorage, projectId).kind !== "none"
    )
      return;
    if (Math.floor(Date.now() / 1000) >= plan.validUntil) {
      setError("The wallet signing window expired. Refresh trustline readiness.");
      return;
    }

    const evidence: PendingCustomerTrustline = {
      version: 1,
      network: "testnet",
      projectId,
      assetCode: plan.assetCode,
      destinationPublicKey: plan.destinationPublicKey,
      issuerPublicKey: plan.issuerPublicKey,
      amount: plan.amount,
      transactionHash: plan.transactionHash,
      unsignedXdr: plan.unsignedXdr,
      validUntil: plan.validUntil,
    };
    busy.current = true;
    setWorking(true);
    setError(null);
    // Persist BEFORE invoking Albedo: wallet rejection, unknown HTTP response,
    // reload and process interruption must all retain the same hash.
    if (!storePendingCustomerTrustline(window.localStorage, evidence)) {
      setPending(true);
      setPlan(null);
      setError("Cannot persist the exact ChangeTrust hash. Wallet signing is blocked.");
      busy.current = false;
      setWorking(false);
      return;
    }
    setPending(true);
    setPlan(null);
    try {
      const { default: albedo } = await import("@albedo-link/intent");
      const signed = await albedo.tx({
        xdr: evidence.unsignedXdr,
        pubkey: evidence.destinationPublicKey,
        network: "testnet",
        submit: true,
        description: "Authorize the exact Orrylo Testnet trustline",
      });
      if (
        signed.tx_hash?.toLowerCase() !== evidence.transactionHash ||
        signed.network !== "testnet"
      ) {
        throw new Error("Albedo did not prove this exact Testnet submission.");
      }
      // The callback is not ledger confirmation; the reconciliation request
      // below is the only mechanism allowed to release this pending hash.
    } catch (cause) {
      setError(
        classifyWalletIntentError(cause) === "rejected"
          ? "Wallet cancelled. The saved exact hash must still be reconciled before another signing action."
          : "Wallet submission may be uncertain. The original transaction hash is retained; do not sign again.",
      );
    } finally {
      busy.current = false;
      setWorking(false);
      queueMicrotask(() => void loadReadiness());
    }
  }

  async function finish() {
    if (
      busy.current ||
      finishing.current ||
      pending ||
      plan?.status !== "ready" ||
      readPendingCustomerTrustline(window.localStorage, projectId).kind !== "none"
    ) return;
    finishing.current = true;
    setWorking(true);
    try {
      await onConfirmed();
    } finally {
      finishing.current = false;
      setWorking(false);
    }
  }

  return (
    <section className="draft-step" aria-label="Customer-funded trustline">
      <h3>Wallet delivery and network fees</h3>
      <p>
        The authenticated customer wallet receives the full initial supply.
        Orrylo controls the Shared Issuer, not your wallet. No sponsored
        reserves or claimable balance is used.
      </p>
      {plan ? (
        <dl className="preview-facts">
          <div>
            <dt>Network</dt>
            <dd>Stellar Testnet</dd>
          </div>
          <div>
            <dt>Asset and amount</dt>
            <dd>
              {plan.assetCode} · {plan.amount}
            </dd>
          </div>
          <div>
            <dt>Exact issuer</dt>
            <dd>
              <code>{plan.issuerPublicKey}</code>
            </dd>
          </div>
          <div>
            <dt>Receiving wallet / trustline fee payer</dt>
            <dd>
              <code>{plan.destinationPublicKey}</code>
            </dd>
          </div>
          <div>
            <dt>Customer trustline fee</dt>
            <dd>
              {plan.customerFeeStroops} stroops (cap{" "}
              {plan.customerFeeCapStroops})
            </dd>
          </div>
          <div>
            <dt>Additional customer reserve</dt>
            <dd>{plan.additionalReserveStroops} stroops</dd>
          </div>
          <div>
            <dt>Orrylo issuer transaction fee</dt>
            <dd>{plan.issuerFeeStroops} stroops (paid by issuer)</dd>
          </div>
          <div>
            <dt>Trustline status</dt>
            <dd>
              {plan.status === "ready"
                ? "Verified ready"
                : "Customer signature required"}
            </dd>
          </div>
        </dl>
      ) : null}
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      {pending ? (
        <p role="status">
          An exact ChangeTrust transaction may already have reached Testnet.
          Another wallet signature stays disabled until this transaction is
          authoritatively resolved or the trustline is independently verified ready.
        </p>
      ) : null}
      {plan?.status === "signature_required" && !pending ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={working}
          onClick={() => void approveTrustline()}
        >
          {working
            ? "Waiting for Albedo / ledger…"
            : "Approve ChangeTrust in Albedo"}
        </button>
      ) : null}
      {plan?.status === "ready" ? (
        <button
          type="button"
          className="button button-primary"
          disabled={working}
          onClick={() => void finish()}
        >
          {working ? "Creating token…" : "Confirm Create Token"}
        </button>
      ) : null}
      {!working ? (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void loadReadiness()}
        >
          {pending
            ? "Reconcile exact ChangeTrust hash"
            : "Refresh network fees and readiness"}
        </button>
      ) : null}
    </section>
  );
}

async function readResponse(response: Response): Promise<{
  ok: boolean;
  trustline: CustomerTrustlineState;
  code?: string;
} | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readReconciliation(response: Response): Promise<{
  ok: boolean;
  reconciliation: {
    status: "ready" | "terminal" | "pending";
    trustline?: CustomerTrustlineState;
  };
} | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
