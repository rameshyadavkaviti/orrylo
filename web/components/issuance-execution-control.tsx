"use client";

import { useRef, useState } from "react";

type ExecutionState =
  | "intent_persisted"
  | "preparing_issuance"
  | "signing_submitting"
  | "confirming"
  | "confirmed"
  | "reconciliation_required"
  | "failed_before_submission";

export function IssuanceExecutionControl({
  projectId,
  requestId,
  initialState,
}: {
  projectId: string;
  requestId: string;
  initialState: ExecutionState;
}) {
  const [state, setState] = useState(initialState);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const busy = useRef(false);

  async function startOrResume() {
    if (
      busy.current ||
      state === "confirmed" ||
      state === "failed_before_submission"
    )
      return;
    busy.current = true;
    setState(
      state === "reconciliation_required" ? "confirming" : "preparing_issuance",
    );
    try {
      const response = await fetch(
        `/api/projects/${projectId}/issuance/execution`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
        },
      );
      const result: unknown = await response.json();
      if (!response.ok || !isExecutionResponse(result)) {
        setState(initialState);
        return;
      }
      const execution = result.execution;
      if (execution.status === "confirmed") {
        setTransactionHash(execution.transactionHash);
        setState("confirmed");
      } else if (execution.status === "preparing_issuance") {
        setState("preparing_issuance");
      } else if (execution.status === "confirming") {
        setTransactionHash(execution.transactionHash);
        setState("confirming");
      } else if (execution.status === "reconciliation_required") {
        setTransactionHash(execution.transactionHash);
        setState("reconciliation_required");
      } else {
        setState("failed_before_submission");
      }
    } catch {
      setState(initialState);
    } finally {
      busy.current = false;
    }
  }

  return (
    <div>
      <p role={state === "reconciliation_required" ? "alert" : "status"}>
        {describe(state)}
      </p>
      {transactionHash ? (
        <p>
          Exact transaction hash: <code>{transactionHash}</code>
        </p>
      ) : null}
      {state !== "confirmed" && state !== "failed_before_submission" ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={
            state === "preparing_issuance" || state === "signing_submitting"
          }
          onClick={() => void startOrResume()}
        >
          {state === "reconciliation_required" || state === "confirming"
            ? "Check exact transaction"
            : "Create Token"}
        </button>
      ) : null}
    </div>
  );
}

function describe(state: ExecutionState): string {
  switch (state) {
    case "intent_persisted":
      return "Immutable intent persisted. No transaction has been submitted.";
    case "preparing_issuance":
      return "Preparing issuance from server-authoritative intent.";
    case "signing_submitting":
      return "Signing and submitting the single durable attempt.";
    case "confirming":
      return "Confirming the exact transaction with official Testnet Horizon.";
    case "confirmed":
      return "Confirmed with authoritative durable ledger evidence.";
    case "reconciliation_required":
      return "Submission is ambiguous. No resubmission is allowed; reconcile only this exact hash.";
    case "failed_before_submission":
      return "Creation failed before submission. No automatic retry or successor attempt was created.";
  }
}

function isExecutionResponse(value: unknown): value is {
  ok: true;
  execution:
    | { status: "confirmed"; transactionHash: string }
    | { status: "preparing_issuance" }
    | { status: "confirming"; transactionHash: string }
    | { status: "reconciliation_required"; transactionHash: string }
    | { status: "failed_before_submission"; failureCode: string };
} {
  if (!value || typeof value !== "object") return false;
  const root = value as Record<string, unknown>;
  return (
    root.ok === true &&
    Boolean(root.execution) &&
    typeof root.execution === "object"
  );
}
