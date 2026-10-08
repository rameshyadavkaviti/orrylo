export function RyloPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">RYLO</span>
        <h1>Membership and utility for people building with Orrylo.</h1>
        <p>
          RYLO is the Orrylo ecosystem utility token. The approved policy connects
          membership to successful building—not investment-return promises.
        </p>
      </div>

      <section className="value-grid" aria-label="RYLO membership path">
        <article className="value-card">
          <span className="step-number">01</span>
          <h2>Become eligible</h2>
          <p>
            Your wallet becomes eligible after your first successful token
            creation through Orrylo.
          </p>
        </article>
        <article className="value-card">
          <span className="policy-value">50</span>
          <h2>Free Build Credit</h2>
          <p>
            50 RYLO-equivalent of internal service credit. It is not minted
            RYLO, transferable, or tradable.
          </p>
        </article>
        <article className="value-card">
          <span className="policy-value">150</span>
          <h2>Launch reward</h2>
          <p>
            Approved first-successful-token reward: 150 RYLO when the qualifying
            event falls inside the 60-day launch window.
          </p>
        </article>
      </section>

      <section className="two-column">
        <article className="surface-card feature-card">
          <span className="eyebrow">Current approved policy</span>
          <h2>Clear rules, separate states.</h2>
          <ul className="fact-list">
            <li>Eligibility is wallet-bound and permanent by default.</li>
            <li>
              Eligibility and Stellar trustline authorization are separate.
            </li>
            <li>Maximum supply policy: 100,000,000 RYLO; initial mint: 0.</li>
            <li>Eligible, authorized members may transfer and trade RYLO.</li>
          </ul>
        </article>

        <article className="surface-card feature-card">
          <span className="eyebrow">Launch window</span>
          <h2>60 days from the official launch timestamp.</h2>
          <p className="muted">
            The exact official launch timestamp is intentionally not chosen or
            configured in the repository yet. Successful creation after the
            window may still establish eligibility without the launch reward.
          </p>
          <span className="availability-badge">Reward execution not live</span>
        </article>
      </section>

      <article className="prototype-boundary">
        <div>
          <span className="eyebrow">Price transparency</span>
          <strong>Approved Orrylo direct sale price: 1 RYLO = 0.1 XLM</strong>
        </div>
        <p>
          This is a direct Orrylo sale policy, not intrinsic value, guaranteed
          market value, guaranteed resale value, or a promise of future value.
          Direct sale and on-chain RYLO execution are not active in this
          prototype.
        </p>
      </article>
    </div>
  );
}

export default RyloPage;
