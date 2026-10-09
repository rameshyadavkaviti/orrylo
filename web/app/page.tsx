import Link from "next/link";

export function HomePage() {
  return (
    <div className="page-stack public-home">
      <section className="hero public-hero">
        <div className="hero-copy">
          <span className="hero-kicker">Build your idea on Stellar</span>
          <h1>Create your Stellar token in minutes.</h1>
          <p>
            Start configuring immediately—no wallet connection required just to
            explore. Build the identity, brand, and presentation, then see what
            Orrylo would create before any on-chain step.
          </p>
          <div className="hero-actions">
            <Link className="button button-inverted" href="/create-token">
              Create Token
            </Link>
            <a className="button button-ghost" href="#wallet-connect">
              Connect Wallet
            </a>
          </div>
          <p className="hero-reassurance">
            You can use the token builder anonymously. Wallet authentication is
            for later identity and execution steps.
          </p>
          <div className="hero-links" aria-label="Explore Orrylo">
            <Link href="/products">Products &amp; Services →</Link>
            <Link href="/rylo">Explore RYLO →</Link>
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
          Orrylo helps you shape a token or product first, understand the
          infrastructure behind it, and move toward real Stellar execution only
          when the required product and security boundaries are available.
        </p>
      </section>

      <section className="value-grid" aria-label="How the token builder works">
        <article className="value-card">
          <span className="step-number">01</span>
          <h2>Build anonymously</h2>
          <p>
            Choose an asset code, name, description, and logo without connecting
            a wallet.
          </p>
        </article>
        <article className="value-card">
          <span className="step-number">02</span>
          <h2>See it come together</h2>
          <p>
            Watch a live token profile update while Orrylo explains issuer and
            metadata infrastructure.
          </p>
        </article>
        <article className="value-card">
          <span className="step-number">03</span>
          <h2>Connect only when needed</h2>
          <p>
            Wallet identity and Stellar execution stay behind the later launch
            boundary rather than blocking exploration.
          </p>
        </article>
      </section>

      <section className="two-column">
        <article className="surface-card feature-card">
          <span className="eyebrow">Products &amp; Services</span>
          <h2>Token creation is the starting point, not the finish line.</h2>
          <p className="muted">
            Orrylo is designed to grow into metadata, domain, dedicated issuer,
            and custom Stellar infrastructure as those product paths become
            available.
          </p>
          <Link className="text-link" href="/products">
            Browse Products &amp; Services
          </Link>
        </article>

        <article className="surface-card feature-card">
          <span className="eyebrow">RYLO ecosystem</span>
          <h2>Membership is a benefit of building with Orrylo.</h2>
          <p className="muted">
            RYLO policy connects a first successful Orrylo token creation to
            ecosystem eligibility and the approved launch-benefit path. It does
            not need to interrupt anonymous product exploration.
          </p>
          <Link className="text-link" href="/rylo">
            Understand RYLO
          </Link>
        </article>
      </section>

      <section
        className="prototype-boundary"
        aria-label="Prototype availability"
      >
        <div>
          <span className="eyebrow">Try the core product now</span>
          <strong>Anonymous token configuration and live preview</strong>
        </div>
        <p>
          On-chain token issuance is not enabled yet. Orrylo keeps that
          execution boundary explicit instead of presenting a preview as a
          successful Stellar launch.
        </p>
      </section>
    </div>
  );
}

export default HomePage;
