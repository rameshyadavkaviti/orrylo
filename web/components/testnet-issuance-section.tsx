import { ConfirmInitialSupplyIntent } from "./confirm-initial-supply-intent";
import { IssuanceExecutionControl } from "./issuance-execution-control";
import type { TestnetIssuanceRecord } from "../lib/server/projects/testnet-issuance-service";
import type { ManagedProjectProfile } from "../lib/projects/project-profile";

const descriptions = {
  awaiting_issuer_integration:
    "Your immutable request is saved. The approved isolated Testnet signer must be available before issuance.",
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
  intentConfigurationAvailable = false,
}: {
  project: ManagedProjectProfile;
  issuance: TestnetIssuanceRecord | null;
  intentConfigurationAvailable?: boolean;
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
          <dd>{issuance?.status.replaceAll("_", " ") ?? "not started"}</dd>
        </div>
      </dl>
      {!supported ? (
        <p role="status">
          This integration supports only Testnet Shared Issuer projects.
          Dedicated and public-network execution are not enabled.
        </p>
      ) : issuance ? (
        <p role="status">
          {issuance.completeIntent
            ? descriptions[issuance.status]
            : descriptions[issuance.status]}
        </p>
      ) : (
        <p role="status">
          Issuance has not started. The reviewed Stellar signing and ledger
          verification integration is required before an action can be enabled.
        </p>
      )}
      {issuance?.completeIntent ? (
        <>
          <dl className="managed-project-facts">
            <div>
              <dt>Immutable initial supply</dt>
              <dd>{issuance.completeIntent.initialSupply}</dd>
            </div>
            <div>
              <dt>Amount in stroops</dt>
              <dd>{issuance.completeIntent.amountStroops}</dd>
            </div>
            <div>
              <dt>Receiving owner wallet</dt>
              <dd>
                <code>{issuance.completeIntent.destinationPublicKey}</code>
              </dd>
            </div>
            <div>
              <dt>Committed intent fingerprint</dt>
              <dd>
                <code>{issuance.completeIntent.fingerprint}</code>
              </dd>
            </div>
            <div>
              <dt>Execution state</dt>
              <dd>{descriptions[issuance.status]}</dd>
            </div>
          </dl>
          <IssuanceExecutionControl
            projectId={project.projectId}
            requestId={issuance.requestId}
            initialState={
              issuance.status === "confirmed"
                ? "confirmed"
                : issuance.status === "reconciliation_required"
                  ? "reconciliation_required"
                  : issuance.status === "submitted"
                    ? "confirming"
                    : issuance.status === "failed"
                      ? "failed_before_submission"
                      : "intent_persisted"
            }
          />
        </>
      ) : supported && !issuance ? (
        <ConfirmInitialSupplyIntent
          projectId={project.projectId}
          assetCode={project.assetCode}
          ownerPublicKey={project.ownerPublicKey}
          available={intentConfigurationAvailable}
        />
      ) : null}
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
              <a href={`https://horizon-testnet.stellar.org/transactions/${issuance.transactionHash}`} target="_blank" rel="noopener noreferrer">
                <code>{issuance.transactionHash}</code>
              </a>
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
        Orrylo never treats browser state or a submission response as
        confirmation. Success requires durable exact-hash ledger evidence.
      </p>
    </section>
  );
}
