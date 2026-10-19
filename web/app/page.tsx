import Link from "next/link";

export default function HomePage() {
  return (
    <div className="clean-home">
      <section className="clean-hero" aria-labelledby="home-title">
        <div className="clean-hero-copy">
          <span className="clean-kicker"><span className="clean-dot" /> BUILT FOR STELLAR · TESTNET PREVIEW</span>
          <h1 id="home-title">Your token.<br /><span>Made simple.</span></h1>
          <p>Give your idea an identity. Design and preview a Stellar token in a few easy steps—no wallet required to start.</p>
          <div className="clean-actions">
            <Link className="clean-cta" href="/create-token">Create your token <span aria-hidden="true">↗</span></Link>
            <a className="clean-subtle-link" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <p className="clean-disclaimer">Free to explore · No transaction until you explicitly confirm</p>
        </div>
        <div className="clean-visual" aria-hidden="true">
          <div className="clean-visual-glow" />
          <div className="clean-token-halo clean-halo-one" />
          <div className="clean-token-halo clean-halo-two" />
          <div className="clean-token-core">O</div>
          <div className="clean-visual-caption"><span className="clean-caption-dot" /> YOUR NEXT IDEA STARTS HERE</div>
        </div>
      </section>
      <section id="how-it-works" className="clean-steps" aria-labelledby="steps-heading">
        <div className="clean-section-heading">
          <span className="clean-kicker">THE PROCESS</span>
          <h2 id="steps-heading">Three steps. One clear start.</h2>
        </div>
        <div className="clean-step-grid">
          <article><span>01 / DESIGN</span><h3>Make it yours.</h3><p>Choose a name, asset code and look for your token.</p></article>
          <article><span>02 / PREVIEW</span><h3>See the result.</h3><p>Review its identity and details before taking any action.</p></article>
          <article><span>03 / CONNECT</span><h3>Move forward safely.</h3><p>Connect your wallet when supported launch steps are ready.</p></article>
        </div>
      </section>
      <section className="clean-bottom">
        <div><span className="clean-kicker">BUILD ON STELLAR</span><h2>Start small. Build something real.</h2><p>Explore the builder today. On-chain issuance is not yet enabled in this prototype.</p></div>
        <Link href="/create-token" className="clean-cta">Open token builder <span aria-hidden="true">↗</span></Link>
      </section>
    </div>
  );
}
