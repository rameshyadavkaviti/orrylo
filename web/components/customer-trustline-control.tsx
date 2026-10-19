"use client";

import { useEffect, useRef, useState } from "react";

import { classifyWalletIntentError } from "../lib/wallet/errors";
import {
  clearResolvedCustomerTrustline,
  pendingCustomerTrustlineKey,
  readPendingCustomerTrustline,
  withCustomerTrustlineHandoff,
  type PendingCustomerTrustline,
} from "../lib/projects/pending-customer-trustline";

export interface CustomerTrustlineState {
  status: "ready" | "signature_required" | "pending";
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
  const [existingTrustlineAccepted, setExistingTrustlineAccepted] = useState(false);
  const busy = useRef(false);
  const finishing = useRef(false);

  function matchesReview(value: CustomerTrustlineState): boolean {
    return (
      value.network === "testnet" &&
      value.assetCode === assetCode &&
      (value.status === "pending" || value.amount === amount) &&
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
    setExistingTrustlineAccepted(false);
    try {
      // Reconcile the persisted exact hash before any ordinary readiness
      // refresh. A not-ready trustline is NEVER proof of failed submission.
      const previous = readPendingCustomerTrustline(
        window.localStorage,
        projectId,
      );
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
          setError(
            "An earlier ChangeTrust for this project must be reconciled before another signing action.",
          );
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
        if (
          !response.ok ||
          !result?.ok ||
          result.reconciliation.status === "pending"
        ) {
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
          setError(
            "Previous ChangeTrust evidence could not be safely released.",
          );
          return;
        }
        setPlan(fresh.status === "pending" ? null : fresh);
        setPending(fresh.status === "pending");
        return;
      }

      const fresh = await inspectFresh();
      if (fresh.status === "pending") {
        // A different authenticated browser may own the one durable handoff.
        // Never expose its XDR or enable another signature on this session.
        setPlan(null);
        setPending(true);
        if (!fresh.transactionHash) {
          setError("A pending ChangeTrust could not be reconciled.");
          return;
        }
        const response = await fetch(
          `/api/projects/${projectId}/issuance/trustline`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount,
              transactionHash: fresh.transactionHash,
              reconcile: true,
            }),
          },
        );
        const result = await readReconciliation(response);
        if (
          !response.ok ||
          !result?.ok ||
          result.reconciliation.status === "pending"
        ) {
          setError(
            "The server-authoritative ChangeTrust transaction is unresolved. Do not sign again.",
          );
          return;
        }
        const checked =
          result.reconciliation.status === "ready" &&
          result.reconciliation.trustline &&
          matchesReview(result.reconciliation.trustline)
            ? result.reconciliation.trustline
            : await inspectFresh();
        if (
          !checked ||
          !matchesReview(checked) ||
          checked.status === "pending"
        ) {
          setError("Another pending ChangeTrust still blocks signing.");
          return;
        }
        setPlan(checked);
        setPending(false);
        return;
      }
      setPlan(fresh);
      setPending(false);
    } catch {
      setPlan(null);
      const prior = readPendingCustomerTrustline(
        window.localStorage,
        projectId,
      );
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
      plan?.status !== "signature_required" ||
      readPendingCustomerTrustline(window.localStorage, projectId).kind !==
        "none"
    )
      return;

    busy.current = true;
    setWorking(true);
    setError(null);
    // The POST claim is the only way to obtain signable XDR; GET inspection
    // never holds a reservation or hands a transaction to Albedo.
    setPlan(null);
    setPending(true);
    try {
      const reservation = await fetch(
        `/api/projects/${projectId}/issuance/trustline`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, reserve: true }),
        },
      );
      const result = await readResponse(reservation);
      if (!reservation.ok || !result?.ok || !matchesReview(result.trustline)) {
        throw new Error(result?.code ?? "trustline_reservation_unavailable");
      }
      const reserved = result.trustline;
      if (reserved.status === "pending") {
        setError(
          "An earlier ChangeTrust is unresolved. Reconcile its exact hash before another signature.",
        );
        return;
      }
      if (reserved.status === "ready") {
        setPending(false);
        setPlan(reserved);
        return;
      }
      if (
        reserved.status !== "signature_required" ||
        !reserved.unsignedXdr ||
        !reserved.transactionHash ||
        !reserved.validUntil ||
        Math.floor(Date.now() / 1000) >= reserved.validUntil
      ) {
        throw new Error("trustline_transaction_mismatch");
      }

      const evidence: PendingCustomerTrustline = {
        version: 1,
        network: "testnet",
        projectId,
        assetCode: reserved.assetCode,
        destinationPublicKey: reserved.destinationPublicKey,
        issuerPublicKey: reserved.issuerPublicKey,
        amount: reserved.amount,
        transactionHash: reserved.transactionHash,
        unsignedXdr: reserved.unsignedXdr,
        validUntil: reserved.validUntil,
      };
      // Persist the exact winning server reservation BEFORE opening Albedo.
      // If the browser closes in between, another session can recover the
      // durable pending hash without generating a second signable plan.
      const handedOff = await withCustomerTrustlineHandoff(
        window.localStorage,
        evidence,
        navigator.locks,
        async () => {
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
            throw new Error(
              "Albedo did not prove this exact Testnet submission.",
            );
          }
          // Wallet callback is not ledger confirmation. Exact-hash
          // reconciliation below is the only release mechanism.
        },
      );
      if (!handedOff) {
        setError(
          "Another tab owns this handoff, or secure browser locking is unavailable. No wallet action was started.",
        );
      }
    } catch (cause) {
      setError(
        classifyWalletIntentError(cause) === "rejected"
          ? "Wallet cancelled. The saved exact hash must still be reconciled before another signing action."
          : "The ChangeTrust reservation or submission may be uncertain. No further signature is allowed until reconciliation.",
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
      !existingTrustlineAccepted ||
      readPendingCustomerTrustline(window.localStorage, projectId).kind !==
        "none"
    )
      return;
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
      <div className="step-heading">
        <span className="step-number">7</span>
        <div>
          <h3>Establish trustline</h3>
          <p>Authorize your wallet to receive this exact Stellar Testnet asset before token issuance.</p>
        </div>
      </div>
      <h4>Wallet delivery and network fees</h4>
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
                ? "Existing trustline verified on Testnet"
                : "Trustline not established · wallet approval required"}
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
          authoritatively resolved or the trustline is independently verified
          ready.
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
            ? "Establishing trustline…"
            : "Establish Trustline in Albedo"}
        </button>
      ) : null}
      {plan?.status === "ready" && !pending && !existingTrustlineAccepted ? (
        <> 
        <p className="builder-boundary-note">This wallet already has a valid trustline for the exact issuer and asset code. No new ChangeTrust signature is needed. Confirm that you want to use this existing trustline.</p>
        <button type="button" className="button button-secondary" disabled={working}
          onClick={() => setExistingTrustlineAccepted(true)}>
          Use verified existing trustline
        </button>
        </>
      ) : null}
      {plan?.status === "ready" && !pending && existingTrustlineAccepted ? (
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
