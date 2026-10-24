import Image from "next/image";
import Link from "next/link";

export function HomePage() {
  return (
    <div className="clean-home">
      <section className="clean-hero" aria-labelledby="home-title">
        <div className="clean-hero-copy">
          <span className="clean-kicker"><span className="clean-dot" /> THE STELLAR ASSET STUDIO</span>
          <h1 id="home-title">Your idea.<br /><span>Your asset.</span></h1>
          <p>Design an asset, preview its identity and supply, then follow one guided journey from wallet approval to a verified Stellar result.</p>
          <div className="clean-actions">
            <Link className="clean-cta" href="/create-token">Create your asset <span aria-hidden="true">↗</span></Link>
            <a className="clean-subtle-link" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <p className="clean-disclaimer">Explore without a wallet · Testnet issuance available · Mainnet creation not yet enabled</p>
        </div>
        <div className="clean-visual" aria-hidden="true">
          <div className="clean-visual-glow" />
          <div className="clean-token-core">
            <Image src="/brand/orrylo-hero-high-quality.webp" alt="" width={1254} height={1254} sizes="(max-width: 620px) 205px, (max-width: 900px) 240px, 310px" className="clean-token-logo" priority />
          </div>
          <div className="clean-visual-caption">Turn your <strong>idea</strong> into a product</div>
        </div>
      </section>

      <section id="how-it-works" className="clean-steps" aria-labelledby="steps-heading">
        <div className="clean-section-heading">
          <span className="clean-kicker">ONE GUIDED JOURNEY</span>
          <h2 id="steps-heading">From first idea to verified asset.</h2>
          <p className="home-section-intro">A clear next step at every stage. No separate save-project detour.</p>
        </div>
        <div className="clean-step-grid">
          <article><span>01 / DESIGN</span><h3>Make it yours.</h3><p>Choose an asset code, name, supply and image. Preview everything before connecting a wallet.</p></article>
          <article><span>02 / REVIEW</span><h3>Know what happens next.</h3><p>Review the exact configuration. Connect Albedo only when you&apos;re ready to proceed.</p></article>
          <article><span>03 / VERIFY</span><h3>Finish with proof.</h3><p>Approve the Testnet trustline and issuance, then see the confirmed on-chain result.</p></article>
        </div>
      </section>

      <section className="home-network-section" aria-labelledby="network-heading">
        <div className="clean-section-heading">
          <span className="clean-kicker">NETWORK TRANSPARENCY</span>
          <h2 id="network-heading">Explore freely. Choose your network.</h2>
        </div>
        <div className="home-network-grid">
          <article className="home-network-card">
            <span className="home-network-tag">TESTNET · AVAILABLE</span>
            <h3>Try the complete creation flow.</h3>
            <p>Design an asset and approve its Testnet trustline and issuance with your wallet. No real XLM service payment is collected.</p>
            <Link href="/create-token?network=testnet">Start on Testnet <span aria-hidden="true">↗</span></Link>
          </article>
          <article className="home-network-card">
            <span className="home-network-tag home-network-tag-muted">MAINNET · PREPARING</span>
            <h3>Built for real-world launches.</h3>
            <p>Mainnet asset creation will cost 10 XLM per asset plus applicable network fees and reserves. Payments and issuance stay gated until activation.</p>
            <Link href="/create-token?network=public">Preview Mainnet details <span aria-hidden="true">↗</span></Link>
          </article>
        </div>
      </section>

      <section className="clean-bottom">
        <div>
          <span className="clean-kicker">READY TO CREATE?</span>
          <h2>Build your next asset on Stellar.</h2>
          <p>Start with the design. You can connect your wallet when you&apos;re ready.</p>
        </div>
        <Link href="/create-token" className="clean-cta">Create your asset <span aria-hidden="true">↗</span></Link>
      </section>
    </div>
  );
}

export default HomePage;
