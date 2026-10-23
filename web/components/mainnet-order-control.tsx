"use client";

import { useState } from "react";

import { classifyWalletIntentError } from "../lib/wallet/errors";

interface MainnetOrderView {
  orderId: string;
  projectId: string;
  ownerPublicKey: string;
  issuerPublicKey: string;
  treasuryPublicKey: string;
  destinationPublicKey: string;
  assetCode: string;
  amount: string;
  priceStroops: string;
  paymentMemo: string;
  status:
    | "awaiting_payment"
    | "paid"
    | "trustline_pending"
    | "trustline_confirmed"
    | "issuance_pending"
    | "issuance_reconciliation_required"
    | "issued";
  publicationStatus: "pending" | "verified" | "failed";
  publicationErrorCode: string | null;
  paymentTransactionHash: string | null;
  trustlineTransactionHash: string | null;
  issuanceTransactionHash: string | null;
}

export function MainnetOrderControl({
  initialOrder,
  activationEnabled,
}: {
  initialOrder: MainnetOrderView;
  activationEnabled: boolean;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function trust() {
    setBusy(true);
    setMessage("Reconciling the reserved trustline before wallet authorization…");
    try {
      const prepared = await command<{
        order: MainnetOrderView;
        trustline: {
          status: "ready" | "signature_required";
          unsignedXdr?: string;
          transactionHash?: string;
        };
      }>(order.projectId, { action: "prepare_trustline" });
      if (prepared.trustline.status === "ready") {
        setOrder(prepared.order);
        setMessage("The exact Mainnet trustline is verified.");
        return;
      }
      if (!prepared.trustline.unsignedXdr || !prepared.trustline.transactionHash) {
        throw new Error("trustline_evidence_missing");
      }
      const { default: albedo } = await import("@albedo-link/intent");
      const submitted = await albedo.tx({
        xdr: prepared.trustline.unsignedXdr,
        pubkey: order.ownerPublicKey,
        network: "public",
        submit: true,
        description: `Establish the ${order.assetCode} Mainnet trustline`,
      });
      if (
        submitted.network !== "public" ||
        submitted.tx_hash?.toLowerCase() !== prepared.trustline.transactionHash
      ) {
        throw new Error("trustline_submission_mismatch");
      }
      setOrder(await command<MainnetOrderView>(order.projectId, {
        action: "confirm_trustline",
        transactionHash: prepared.trustline.transactionHash,
      }));
      setMessage("The exact Mainnet trustline is verified.");
    } catch (error) {
      setMessage(
        classifyWalletIntentError(error) === "rejected"
          ? "Trustline authorization was cancelled. The reserved transaction can be resumed."
          : "Trustline is unverified. Retry uses only the same reserved transaction hash.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    setMessage("Reconciling the one permitted issuance transaction…");
    try {
      setOrder(await command<MainnetOrderView>(order.projectId, { action: "issue" }));
      setMessage("Issuance reconciliation completed. Refresh for publication status.");
    } catch {
      setMessage(
        "Issuance remains in exact-hash reconciliation. Orrylo will not sign or submit a replacement.",
      );
    } finally {
      setBusy(false);
    }
  }

  const paymentPending = order.status === "awaiting_payment";
  const trustlinePending = order.status === "paid" || order.status === "trustline_pending";
  const issuancePending = [
    "trustline_confirmed",
    "issuance_pending",
    "issuance_reconciliation_required",
  ].includes(order.status);

  return (
    <section className="surface-card" aria-label="Mainnet token order">
      <span className="eyebrow">Stellar Mainnet · Shared Issuer</span>
      <h2>Immutable token order</h2>
      <dl className="managed-project-facts">
        <div><dt>Order status</dt><dd>{order.status.replaceAll("_", " ")}</dd></div>
        <div><dt>Initial supply</dt><dd>{order.amount}</dd></div>
        <div><dt>Payment</dt><dd>{order.paymentTransactionHash ? "Verified" : "10 XLM required"}</dd></div>
        <div><dt>Publication</dt><dd>{order.publicationStatus === "verified" ? "Metadata Verified" : "Metadata Pending / Failed"}</dd></div>
      </dl>
      {!activationEnabled && order.status !== "issued" ? (
        <p role="status">Mainnet customer activation is pending explicit approval. No wallet action is available.</p>
      ) : null}
      {activationEnabled ? (
        <div className="project-card-actions">
          {paymentPending ? <p role="status">Complete or reconcile the existing exact 10 XLM payment from the token creation screen.</p> : null}
          {trustlinePending ? <button className="button button-primary" type="button" disabled={busy} onClick={() => void trust()}>Establish trustline</button> : null}
          {issuancePending ? <button className="button button-primary" type="button" disabled={busy} onClick={() => void issue()}>Issue and verify</button> : null}
        </div>
      ) : null}
      {message ? <p aria-live="polite">{message}</p> : null}
    </section>
  );
}

async function command<T>(projectId: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`/api/projects/${projectId}/mainnet`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { ok: boolean; result?: T; code?: string };
  if (!response.ok || !result.ok || result.result === undefined) {
    throw new Error(result.code ?? "mainnet_request_failed");
  }
  return result.result;
}
