import Image from "next/image";

export function RyloPage() {
  return (
    <div className="page-stack">
      <div className="page-heading rylo-heading">
        <Image
          className="rylo-logo"
          src="/brand/rylo-logo-v2.webp"
          alt="RYLO"
          width={112}
          height={112}
          priority
        />
        <div>
          <span className="eyebrow">RYLO · Stellar asset</span>
          <h1>A token with its own identity.</h1>
          <p>
            RYLO is a standalone Stellar asset designed for transfer and potential
            trading. It is separate from Orrylo&apos;s token-creation service:
            you do not need to buy, hold, or use RYLO to create a token.
          </p>
        </div>
      </div>

      <section className="value-grid" aria-label="RYLO token overview">
        <article className="value-card">
          <span className="step-number">01</span>
          <h2>Independent asset</h2>
          <p>RYLO has a separate issuer and distribution policy. Orrylo token creation is priced in XLM, not RYLO.</p>
        </article>
        <article className="value-card">
          <span className="policy-value">998M</span>
          <h2>Fixed supply target</h2>
          <p>The approved total supply is 998,000,000 RYLO, intended for a single issuance followed by reviewed supply finalization.</p>
        </article>
        <article className="value-card">
          <span className="policy-value">Open</span>
          <h2>Transferable by design</h2>
          <p>The intended model allows ordinary Stellar trustlines and transfers without Orrylo membership or purchase requirements.</p>
        </article>
      </section>

      <section className="two-column">
        <article className="surface-card feature-card">
          <span className="eyebrow">Approved allocation plan</span>
          <h2>Where the supply is intended to go</h2>
          <ul className="fact-list">
            <li><strong>60%</strong> · Long-term reserve — 598,800,000 RYLO</li>
            <li><strong>20%</strong> · Market liquidity allocation — 199,600,000 RYLO</li>
            <li><strong>15%</strong> · Development and operations — 149,700,000 RYLO</li>
            <li><strong>5%</strong> · Future distribution — 49,900,000 RYLO</li>
          </ul>
          <p className="muted">These are planned allocations, not evidence of tokens in circulation or funded liquidity.</p>
        </article>

        <article className="surface-card feature-card">
          <span className="eyebrow">Launch readiness</span>
          <h2>Policy approved. Launch not confirmed.</h2>
          <p className="muted">
            Issuance, supply-lock controls, custody, token metadata, and any
            liquidity launch require independent on-chain verification and
            separate authorization. The approved policy alone does not prove
            that RYLO has been issued, locked, listed, or made available to trade.
          </p>
          <span className="availability-badge">Public launch not verified</span>
        </article>
      </section>

      <article className="prototype-boundary">
        <div>
          <span className="eyebrow">Transparency</span>
          <strong>No RYLO purchase required for Orrylo</strong>
        </div>
        <p>
          Creating an Orrylo Mainnet token has a separate approved service price
          of 10 XLM per creation when activated. RYLO has no guaranteed
          market value, liquidity, listing, price floor, or investment return.
          The previous direct-sale price and first-build reward programs have
          been superseded.
        </p>
      </article>
    </div>
  );
}

export default RyloPage;
