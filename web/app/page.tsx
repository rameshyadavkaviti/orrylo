import { DemoBanner } from "../components/demo-banner";
import { DASHBOARD_DEMO_STATE } from "../lib/demo/dashboard";

export function DashboardPage() {
  const state = DASHBOARD_DEMO_STATE;

  return (
    <div className="page-stack">
      <DemoBanner />

      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            Build on Stellar without hidden assumptions
          </span>
          <h1>Welcome to Orrylo.</h1>
          <p>
            Start with a transparent asset draft, understand who controls the
            infrastructure, and move on-chain only when approved interfaces exist.
          </p>
          <div className="hero-actions">
            <a className="button button-inverted" href="/create-token">
              Create token draft
            </a>
            <a className="button button-ghost" href="/products">
              Explore services
            </a>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <span>O</span>
        </div>
      </section>

      <section className="metric-grid" aria-label="Account overview">
        <MetricCard
          label="Ecosystem member"
          value="Not verified"
          note="Qualification requires a confirmed qualifying action."
        />
        <MetricCard
          label="RYLO balance"
          value="—"
          note="No live balance read is active."
        />
        <MetricCard
          label="Free Build Credit"
          value="Not issued"
          note="This is not presented as tradable RYLO."
        />
      </section>

      <section className="two-column">
        <article className="surface-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Recent activity</span>
              <h2>Nothing recorded</h2>
            </div>
            <span className="availability-badge">Demo</span>
          </div>
          <p className="muted">
            Activity will be stored only when supported application operations
            exist. No mock transaction is shown as real history.
          </p>
          <a href="/activity" className="text-link">
            Open activity structure
          </a>
        </article>

        <article className="surface-card">
          <span className="eyebrow">Wallet status</span>
          <h2>Connection adapter pending</h2>
          <p className="muted">
            Albedo is the initial target. No wallet proof or
            authorization-sensitive client state is trusted in this phase.
          </p>
          <div className="key-value">
            <span>Source</span>
            <strong>{state.source}</strong>
          </div>
        </article>
      </section>
    </div>
  );
}

function MetricCard({
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

export default DashboardPage;
