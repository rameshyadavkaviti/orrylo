import Link from "next/link";

export function HomePage() {
  return (
    <div className="page-stack public-home">
      <section className="hero public-hero">
        <div className="hero-copy">
          <span className="hero-kicker">Build your idea on Stellar</span>
          <h1>Create your Stellar token in minutes.</h1>
          <p>
            Orrylo gives you a simple place to shape your token, understand the
            infrastructure behind it, and preview the result before anything
            goes on-chain.
          </p>
          <div className="hero-actions">
            <Link className="button button-inverted" href="/create-token">
              Create Token
            </Link>
            <a className="button button-ghost" href="#wallet-connect">
              Connect Wallet
            </a>
          </div>
          <div className="hero-links" aria-label="Explore Orrylo">
            <Link href="/rylo">Explore RYLO →</Link>
            <Link href="/products">Products &amp; Services →</Link>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <span>O</span>
        </div>
      </section>

      <section className="intro-section" aria-labelledby="what-is-orrylo">
        <span className="eyebrow">What is Orrylo?</span>
        <h2 id="what-is-orrylo">A simpler path from token idea to Stellar.</h2>
        <p>
          Start with a guided token draft. Orrylo is designed to grow with you
          into metadata, dedicated issuer infrastructure, RYLO membership, and
          other Stellar services—without hiding which capabilities are ready.
        </p>
      </section>

      <section className="value-grid" aria-label="How the prototype works">
        <article className="value-card">
          <span className="step-number">01</span>
          <h2>Configure</h2>
          <p>
            Choose your asset code and display name with Stellar-compatible
            validation.
          </p>
        </article>
        <article className="value-card">
          <span className="step-number">02</span>
          <h2>Understand</h2>
          <p>
            See the Shared Issuer and metadata model in plain language before
            you continue.
          </p>
        </article>
        <article className="value-card">
          <span className="step-number">03</span>
          <h2>Preview safely</h2>
          <p>
            Review the token draft without pretending an on-chain launch has
            happened.
          </p>
        </article>
      </section>

      <section className="two-column">
        <article className="surface-card feature-card">
          <span className="eyebrow">RYLO membership</span>
          <h2>Build once. Become part of the ecosystem.</h2>
          <p className="muted">
            Approved policy connects your first successful Orrylo token creation
            to membership eligibility, Free Build Credit, and a launch reward
            path.
          </p>
          <Link className="text-link" href="/rylo">
            Understand RYLO
          </Link>
        </article>

        <article className="surface-card feature-card">
          <span className="eyebrow">More than token creation</span>
          <h2>Grow into the services your project needs.</h2>
          <p className="muted">
            Explore metadata, domain, dedicated issuer, and custom Stellar
            services. Unavailable capabilities are clearly marked.
          </p>
          <Link className="text-link" href="/products">
            Browse Products &amp; Services
          </Link>
        </article>
      </section>

      <section className="prototype-boundary" aria-label="Prototype availability">
        <div>
          <span className="eyebrow">Available in this prototype</span>
          <strong>Token drafting, preview, and secure Albedo authentication</strong>
        </div>
        <p>
          Token issuance and other Stellar mutations are not enabled yet. Orrylo
          will never show a draft as a successful on-chain launch.
        </p>
      </section>
    </div>
  );
}

export default HomePage;
