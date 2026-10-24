import Link from "next/link";

const FUTURE_SERVICES = [
  {
    number: "01",
    title: "Dedicated Issuer",
    description: "An issuer controlled separately from Orrylo's shared infrastructure, with its own governance and signing policy.",
  },
  {
    number: "02",
    title: "Advanced Stellar Infrastructure",
    description: "Specialized integrations and contract-backed workflows beyond the standard asset creation path.",
  },
] as const;

export function ProductsPage() {
  return (
    <div className="page-stack products-page">
      <header className="page-heading products-intro">
        <span className="eyebrow">Products &amp; Services</span>
        <h1>Everything starts with an asset.</h1>
        <p>
          Create and manage Stellar assets through one guided experience.
          Start on Testnet, understand the shared issuer model, and see what is
          planned for Mainnet without confusing a preview with a live launch.
        </p>
      </header>

      <section className="products-featured" aria-labelledby="products-featured-title">
        <div className="products-featured-copy">
          <span className="products-status products-status-live">AVAILABLE ON TESTNET</span>
          <h2 id="products-featured-title">Stellar Asset Studio</h2>
          <p>
            Choose your asset code, name, supply and image. Review your
            configuration, connect Albedo, prepare the trustline and verify
            issuance on Stellar Testnet.
          </p>
          <div className="products-featured-points" aria-label="Asset studio features">
            <span>Live asset preview</span>
            <span>Guided wallet approvals</span>
            <span>Verified on-chain result</span>
          </div>
          <Link className="button button-primary" href="/create-token">
            Create your asset <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="products-featured-aside">
          <span className="eyebrow">HOW IT WORKS</span>
          <ol className="products-mini-steps">
            <li><span>01</span><div><strong>Design</strong><small>Explore without connecting a wallet</small></div></li>
            <li><span>02</span><div><strong>Review &amp; connect</strong><small>Approve only when you are ready</small></div></li>
            <li><span>03</span><div><strong>Prepare wallet</strong><small>Authorize the required trustline</small></div></li>
            <li><span>04</span><div><strong>Verify</strong><small>See the confirmed Stellar result</small></div></li>
          </ol>
        </div>
      </section>

      <section className="products-service-section" aria-labelledby="products-service-heading">
        <div className="products-section-title">
          <div>
            <span className="eyebrow">PART OF THE CURRENT EXPERIENCE</span>
            <h2 id="products-service-heading">Built around your asset.</h2>
          </div>
          <Link className="text-link" href="/my-assets">View My Assets ↗</Link>
        </div>
        <div className="products-service-grid">
          <article className="surface-card products-service-card">
            <span className="products-status">PROJECT MANAGEMENT</span>
            <h3>My Assets</h3>
            <p>Return to your saved projects, review their state and manage the asset information available to you.</p>
            <Link href="/my-assets">Open My Assets <span aria-hidden="true">↗</span></Link>
          </article>
          <article className="surface-card products-service-card">
            <span className="products-status">SHARED ISSUER</span>
            <h3>Asset identity &amp; metadata</h3>
            <p>Use Orrylo-managed shared issuer infrastructure. The issuer is not owned by the asset creator; metadata verification and publication depend on confirmed results.</p>
            <Link href="/create-token">Explore the asset builder <span aria-hidden="true">↗</span></Link>
          </article>
        </div>
      </section>

      <section className="products-service-section" aria-labelledby="products-next-heading">
        <div className="products-section-title">
          <div>
            <span className="eyebrow">FUTURE CAPABILITIES</span>
            <h2 id="products-next-heading">More ways to build.</h2>
          </div>
        </div>
        <div className="products-service-grid">
          {FUTURE_SERVICES.map((service) => (
            <article className="surface-card products-service-card products-future-card" key={service.title}>
              <div className="products-future-top"><span>{service.number}</span><span className="products-status products-status-muted">PLANNED</span></div>
              <h3>{service.title}</h3>
              <p>{service.description}</p>
              <span className="products-unavailable">Not yet available</span>
            </article>
          ))}
        </div>
      </section>

      <aside className="products-transparency">
        <div>
          <span className="eyebrow">NETWORK &amp; PRICING</span>
          <strong>Testnet now. Mainnet when activated.</strong>
        </div>
        <p>
          Testnet creation does not collect a real XLM service payment.
          The approved Mainnet service price is 10 XLM per asset, plus any
          applicable Stellar fees and reserves. Mainnet payment and issuance
          are not advertised as active until independently verified.
        </p>
      </aside>
    </div>
  );
}

export default ProductsPage;
