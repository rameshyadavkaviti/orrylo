import Image from "next/image";
import Link from "next/link";

export function HomePage() {
  return (
    <div className="clean-home">
      <section className="clean-hero" aria-labelledby="home-title">
        <div className="clean-hero-copy">
          <span className="clean-kicker"><span className="clean-dot" /> BUILT FOR STELLAR · CHOOSE YOUR NETWORK</span>
          <h1 id="home-title">Your idea.<br /><span>Made tangible.</span></h1>
          <p>Turn a concept into a Stellar-powered product. Shape its identity, preview the details, and move forward when you’re ready.</p>
          <div className="clean-actions">
            <Link className="clean-cta" href="/create-token">Create your product <span aria-hidden="true">↗</span></Link>
            <a className="clean-subtle-link" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <p className="clean-disclaimer">Free to explore · Testnet issuance available · Mainnet payments gated</p>
        </div>
        <div className="clean-visual" aria-hidden="true">
          <div className="clean-visual-glow" />
          <div className="clean-token-halo clean-halo-one" />
          <div className="clean-token-halo clean-halo-two" />
          <div className="clean-token-core"><Image src="/brand/orrylo-logo-1f95ea3.webp" alt="" width={160} height={160} className="clean-token-logo" priority /></div>
          <div className="clean-visual-caption"><span className="clean-caption-dot" /> YOUR NEXT IDEA STARTS HERE</div>
        </div>
      </section>
      <section id="how-it-works" className="clean-steps" aria-labelledby="steps-heading">
        <div className="clean-section-heading">
          <span className="clean-kicker">THE PROCESS</span>
          <h2 id="steps-heading">Three steps. One clear start.</h2>
        </div>
        <div className="clean-step-grid">
          <article><span>01 / DESIGN</span><h3>Make it yours.</h3><p>Give your product a name, asset code, and distinct identity.</p></article>
          <article><span>02 / PREVIEW</span><h3>See the result.</h3><p>Review its identity and details before taking any action.</p></article>
          <article><span>03 / CONNECT</span><h3>Move forward safely.</h3><p>Connect Albedo, approve the exact trustline, and confirm issuance on Stellar Testnet.</p></article>
        </div>
      </section>
      <section className="clean-bottom">
        <div><span className="clean-kicker">BUILD ON STELLAR</span><h2>Make your next idea real.</h2><p>Start with a preview. Testnet issuance is available with explicit wallet approvals; Mainnet payments remain disabled.</p></div>
        <Link href="/create-token" className="clean-cta">Create your product <span aria-hidden="true">↗</span></Link>
      </section>
    </div>
  );
}

export default HomePage;
