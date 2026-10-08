import { CreateSharedTokenForm } from "../../components/create-shared-token-form";
import { SHARED_ASSET_DOMAIN } from "../../lib/product/constants";

export function CreateTokenPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">Create Token</span>
        <h1>Turn your token idea into a clear Stellar-ready draft.</h1>
        <p>
          Configure the identity, understand where metadata will live, and
          preview the result. This prototype stops before on-chain creation.
        </p>
      </div>

      <section className="creation-path" aria-label="Creation path">
        <article className="path-card path-card-active">
          <span className="availability-badge">Prototype available</span>
          <h2>Shared Issuer</h2>
          <p>
            The simple Orrylo path uses shared infrastructure. Your asset remains
            identified by its own code plus the shared issuer.
          </p>
          <ul className="fact-list compact-list">
            <li>Shared Orrylo infrastructure, not a dedicated issuer.</li>
            <li>Asset code must be unique under the Shared Issuer.</li>
            <li>Metadata domain: {SHARED_ASSET_DOMAIN}.</li>
          </ul>
        </article>

        <article className="path-card">
          <span className="availability-badge">Coming soon</span>
          <h2>Dedicated Issuer</h2>
          <p>
            Separate contract-controlled infrastructure for projects that need
            their own issuer and policy model.
          </p>
          <p className="muted">
            Templates and provisioning are not available in this prototype.
          </p>
        </article>
      </section>

      <CreateSharedTokenForm />
    </div>
  );
}

export default CreateTokenPage;
