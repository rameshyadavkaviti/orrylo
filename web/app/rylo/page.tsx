import { DemoBanner } from "../../components/demo-banner";
import { RYLO_ISSUER_CANDIDATE } from "../../lib/product/constants";

export function RyloPage() {
  return (
    <div className="page-stack">
      <DemoBanner />
      <div className="page-heading">
        <span className="eyebrow">RYLO</span>
        <h1>Utility and membership, presented as policy—not value promises.</h1>
        <p>
          No live RYLO balance, direct sale price, market price, reward amount, or
          authorization state is available in Application Phase 1.
        </p>
      </div>

      <section className="metric-grid">
        <RyloMetric label="RYLO amount" value="—" note="No live balance read." />
        <RyloMetric
          label="Eligibility"
          value="Not verified"
          note="A confirmed qualifying Orrylo action is required."
        />
        <RyloMetric
          label="Authorization"
          value="Unknown"
          note="Final authorization mechanism remains unresolved."
        />
      </section>

      <section className="two-column">
        <article className="surface-card">
          <span className="eyebrow">Current policy</span>
          <h2>One-time builder → ecosystem member</h2>
          <p className="muted">
            Creating a token or creating/purchasing a product is sufficient to
            qualify. No later upgrade is required by current policy.
          </p>
        </article>
        <article className="surface-card">
          <span className="eyebrow">Reserved issuer candidate</span>
          <code className="code-block">{RYLO_ISSUER_CANDIDATE}</code>
          <p className="muted">
            Reserved candidate only. This screen does not claim testnet or mainnet
            deployment.
          </p>
        </article>
      </section>

      <article className="surface-card">
        <span className="eyebrow">Price transparency</span>
        <h2>Direct sale price and market price are different facts.</h2>
        <p className="muted">
          No direct sale price is currently fixed. Orrylo will not present a
          future platform sale price as intrinsic value, guaranteed market value,
          or guaranteed future value.
        </p>
      </article>
    </div>
  );
}

function RyloMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export default RyloPage;
