"use client";

import { useEffect, useRef, useState } from "react";

import { classifyWalletIntentError } from "../lib/wallet/errors";

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

  async function loadReadiness() {
    if (busy.current || finishing.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/issuance/trustline?amount=${encodeURIComponent(amount)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const result = await readResponse(response);
      if (!response.ok || !result?.ok) {
        setPlan(null);
        setError(result?.code ?? "Trustline inspection is unavailable.");
        return;
      }
      if (
        result.trustline.assetCode !== assetCode ||
        result.trustline.amount !== amount ||
        result.trustline.network !== "testnet"
      ) {
        throw new Error("Trustline readiness differs from the reviewed token.");
      }
      setPlan(result.trustline);
      setPending(false);
    } catch {
      setPlan(null);
      setError(
        "Could not verify the exact customer trustline. Nothing was issued.",
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  useEffect(() => {
    void loadReadiness();
    // Remount this control when the reviewed amount or project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, amount, assetCode]);

  async function approveTrustline() {
    if (
      busy.current ||
      !plan?.unsignedXdr ||
      !plan.transactionHash ||
      plan.status !== "signature_required" ||
      !plan.validUntil
    )
      return;
    if (Math.floor(Date.now() / 1000) >= plan.validUntil) {
      setError(
        "The wallet signing window expired. Refresh trustline readiness.",
      );
      return;
    }
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      // Only the customer wallet can sign; Albedo submits this server-built
      // one-operation ChangeTrust XDR. A wallet callback is never issuance proof.
      const { default: albedo } = await import("@albedo-link/intent");
      const signed = await albedo.tx({
        xdr: plan.unsignedXdr,
        pubkey: plan.destinationPublicKey,
        network: "testnet",
        submit: true,
        description: "Authorize the exact Orrylo Testnet trustline",
      });
      if (
        signed.tx_hash?.toLowerCase() !== plan.transactionHash ||
        signed.network !== "testnet"
      ) {
        throw new Error(
          "Albedo did not return the expected Testnet transaction.",
        );
      }
      const response = await fetch(
        `/api/projects/${projectId}/issuance/trustline`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            transactionHash: plan.transactionHash,
          }),
        },
      );
      const verified = await readResponse(response);
      if (
        !response.ok ||
        !verified?.ok ||
        verified.trustline.status !== "ready"
      ) {
        setPending(true);
        setError(
          "Trustline submission needs authoritative confirmation. Check readiness; do not sign again.",
        );
        return;
      }
      setPlan(verified.trustline);
      setPending(false);
    } catch (cause) {
      if (classifyWalletIntentError(cause) === "rejected") {
        setError(
          "Wallet approval was cancelled. No issuer transaction started.",
        );
      } else {
        setPending(true);
        setError(
          "Wallet submission or confirmation is uncertain. Check the existing trustline before any new wallet action.",
        );
      }
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  async function finish() {
    if (busy.current || finishing.current || plan?.status !== "ready") return;
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
          A wallet transaction may already have reached Testnet. Do not
          authorize a second transaction until readiness has been checked.
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
            ? "Check existing trustline"
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
