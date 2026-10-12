import type { TestnetIssuanceRecord } from "../lib/server/projects/testnet-issuance-service";
import type { ManagedProjectProfile } from "../lib/projects/project-profile";

const descriptions = {
  awaiting_issuer_integration:
    "Your request is saved. Issuer execution is unavailable until the reviewed Stellar integration is installed.",
  pending_execution: "The request is waiting for a reviewed execution service.",
  submitted:
    "Submission is recorded. Ledger confirmation is not yet established.",
  confirmed: "Confirmed on Stellar Testnet with verified ledger evidence.",
  failed:
    "The issuance attempt failed. Support must reconcile the existing request before retrying.",
  reconciliation_required:
    "Submission outcome needs ledger reconciliation. Do not create a replacement request.",
} as const;

export function TestnetIssuanceSection({
  project,
  issuance,
}: {
  project: ManagedProjectProfile;
  issuance: TestnetIssuanceRecord | null;
}) {
  const supported =
    project.network === "testnet" && project.issuerModel === "shared";
  const status = issuance?.status ?? "not_started";

  return (
    <section className="surface-card" aria-label="Testnet asset issuance">
      <span className="eyebrow">Stellar Testnet · Shared Issuer</span>
      <h2>Token issuance</h2>
      <p>
        Saving your Project Profile does not issue a Stellar asset. Orrylo must
        receive confirmed on-chain evidence before displaying an issued token.
      </p>
      <dl className="managed-project-facts">
        <div>
          <dt>Request status</dt>
          <dd>{status.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{project.network}</dd>
        </div>
        <div>
          <dt>Asset code</dt>
          <dd>{project.assetCode}</dd>
        </div>
        <div>
          <dt>Issuer execution</dt>
          <dd>Not yet available</dd>
        </div>
      </dl>
      {!supported ? (
        <p role="status">
          This integration supports only Testnet Shared Issuer projects.
          Dedicated and public-network execution are not enabled.
        </p>
      ) : issuance ? (
        <p role="status">{descriptions[issuance.status]}</p>
      ) : (
        <p role="status">
          Issuance has not started. The reviewed Stellar signing and ledger
          verification integration is required before an action can be enabled.
        </p>
      )}
      {issuance?.status === "confirmed" &&
      issuance.issuerPublicKey &&
      issuance.transactionHash &&
      issuance.ledgerSequence !== null ? (
        <dl className="managed-project-facts">
          <div>
            <dt>Verified issuer</dt>
            <dd>
              <code>{issuance.issuerPublicKey}</code>
            </dd>
          </div>
          <div>
            <dt>Transaction hash</dt>
            <dd>
              <code>{issuance.transactionHash}</code>
            </dd>
          </div>
          <div>
            <dt>Ledger sequence</dt>
            <dd>{issuance.ledgerSequence}</dd>
          </div>
        </dl>
      ) : null}
      {issuance?.status === "failed" && issuance.failureCode ? (
        <p role="alert">Failure code: {issuance.failureCode}</p>
      ) : null}
      <p className="readiness-note">
        Issuance controls are disabled until the Stellar Agent supplies a
        reviewed, deployed Testnet integration. This page cannot submit or sign
        transactions.
      </p>
    </section>
  );
}
