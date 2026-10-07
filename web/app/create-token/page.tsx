import { CreateSharedTokenForm } from "../../components/create-shared-token-form";
import { DemoBanner } from "../../components/demo-banner";
import {
  SHARED_ASSET_DOMAIN,
  SHARED_ISSUER_CANDIDATE,
} from "../../lib/product/constants";

export function CreateTokenPage() {
  return (
    <div className="page-stack">
      <DemoBanner />

      <div className="page-heading">
        <span className="eyebrow">Create Token</span>
        <h1>Choose the infrastructure before the asset.</h1>
        <p>
          Orrylo separates the low-cost shared path from dedicated
          contract-controlled infrastructure. Neither path performs real
          issuance in this phase.
        </p>
      </div>

      <section className="tier-grid" aria-label="Issuer tiers">
        <article className="tier-card tier-featured">
          <div className="card-title-row">
            <span className="tier-icon" aria-hidden="true">
              S
            </span>
            <span className="availability-badge">Draft available</span>
          </div>
          <h2>Shared Issuer</h2>
          <p>
            Low-cost/free-oriented creation using shared Orrylo-controlled
            infrastructure.
          </p>
          <ul className="fact-list">
            <li>Issuer is shared Orrylo infrastructure, not user-owned.</li>
            <li>Asset codes must be unique under the shared issuer.</li>
            <li>Shared metadata domain: {SHARED_ASSET_DOMAIN}.</li>
            <li>RYLO issuer is not used for customer Shared Issuer assets.</li>
          </ul>
          <div className="disclosure">
            <span>Reserved issuer candidate</span>
            <code>{SHARED_ISSUER_CANDIDATE}</code>
            <small>Candidate only — not represented as live or deployed.</small>
          </div>
        </article>

        <article className="tier-card">
          <div className="card-title-row">
            <span className="tier-icon" aria-hidden="true">
              D
            </span>
            <span className="availability-badge">Coming later</span>
          </div>
          <h2>Dedicated Issuer</h2>
          <p>
            Premium, separate infrastructure targeting the approved
            Contract-Controlled Issuer architecture.
          </p>
          <ul className="fact-list">
            <li>Dedicated to one customer/project infrastructure instance.</li>
            <li>Contract-control target; no raw issuer-key promise.</li>
            <li>Exact templates and authority rules remain unresolved.</li>
            <li>No provisioning action exists in Contract Interface v1.</li>
          </ul>
          <button className="button button-secondary" type="button" disabled>
            Not yet available
          </button>
        </article>
      </section>

      <CreateSharedTokenForm />
    </div>
  );
}

export default CreateTokenPage;
