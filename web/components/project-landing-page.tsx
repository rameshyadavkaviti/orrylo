import Link from "next/link";

import { safeHttpsUrl } from "../lib/projects/project-metadata";
import type { ProjectProfile } from "../lib/projects/project-profile";

export function ProjectLandingPage({ project }: { project: ProjectProfile }) {
  const initial = project.assetCode.slice(0, 1);
  const logoUrl = safeHttpsUrl(project.logoUrl);
  const websiteUrl = safeHttpsUrl(project.websiteUrl);
  const communityUrl = safeHttpsUrl(project.communityUrl);
  const explorerUrl = safeHttpsUrl(project.explorerUrl);

  return (
    <div className="project-public-page">
      <header className="project-public-nav">
        <Link href="/" className="project-public-brand">
          <span className="project-public-brand-mark">O</span>
          <span>
            <strong>Orrylo</strong>
            <small>Built on Stellar</small>
          </span>
        </Link>
        <nav aria-label="Project sections">
          <a href="#about">About</a>
          <a href="#token">Token</a>
          <a href="#project">Project</a>
          {explorerUrl ? (
            <a href={explorerUrl ?? undefined} target="_blank" rel="noreferrer">
              Explorer ↗
            </a>
          ) : null}
        </nav>
      </header>

      <main>
        <section className="project-public-hero">
          <div className="project-public-hero-copy">
            <span className="project-public-kicker">
              {project.category ?? "Stellar project"}
            </span>
            <div className="project-public-title-row">
              {logoUrl ? (
                <span
                  className="project-public-logo"
                  role="img"
                  aria-label={`${project.displayName} logo`}
                  style={{ backgroundImage: `url("${logoUrl}")` }}
                />
              ) : (
                <span className="project-public-logo project-public-logo-fallback">
                  {initial}
                </span>
              )}
              <div>
                <h1>{project.displayName}</h1>
                <strong>{project.assetCode}</strong>
              </div>
            </div>
            <p>
              {project.description ??
                "A Stellar project created and managed with Orrylo."}
            </p>
            <div className="project-public-actions">
              {websiteUrl ? (
                <a
                  className="project-public-button project-public-button-primary"
                  href={websiteUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Visit project
                </a>
              ) : null}
              {communityUrl ? (
                <a
                  className="project-public-button project-public-button-secondary"
                  href={communityUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Join community
                </a>
              ) : null}
            </div>
          </div>
          <div className="project-public-orbit" aria-hidden="true">
            <span>{initial}</span>
          </div>
        </section>

        <section className="project-public-stats" aria-label="Token overview">
          <div>
            <span>Asset code</span>
            <strong>{project.assetCode}</strong>
          </div>
          <div>
            <span>Network</span>
            <strong>
              {project.network === "public"
                ? "Stellar Public"
                : "Stellar Testnet"}
            </strong>
          </div>
          <div>
            <span>Issuer model</span>
            <strong>
              {project.issuerModel === "shared"
                ? "Orrylo Shared Issuer"
                : "Dedicated Issuer"}
            </strong>
          </div>
          <div>
            <span>Project status</span>
            <strong>Published</strong>
          </div>
        </section>

        <section
          id="about"
          className="project-public-section project-public-about"
        >
          <div>
            <span className="project-public-section-kicker">About</span>
            <h2>Built to be understood, shared, and developed further.</h2>
          </div>
          <p>
            {project.description ??
              `${project.displayName} is a Stellar project published through Orrylo.`}
          </p>
        </section>

        <section id="token" className="project-public-section">
          <div className="project-public-section-heading">
            <div>
              <span className="project-public-section-kicker">
                Token information
              </span>
              <h2>Transparent Stellar identity</h2>
            </div>
            {explorerUrl ? (
              <a
                href={explorerUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer ↗
              </a>
            ) : null}
          </div>
          <div className="project-public-info-grid">
            <article>
              <span>Asset code</span>
              <strong>{project.assetCode}</strong>
            </article>
            <article>
              <span>Network</span>
              <strong>{project.network}</strong>
            </article>
            <article>
              <span>Issuer model</span>
              <strong>{project.issuerModel}</strong>
            </article>
            <article>
              <span>Issuer</span>
              <strong className="project-public-mono">
                {project.issuerPublicKey ?? "Not published yet"}
              </strong>
            </article>
          </div>
        </section>

        <section
          id="project"
          className="project-public-section project-public-project-grid"
        >
          <article className="project-public-card">
            <span className="project-public-section-kicker">
              Project details
            </span>
            <h2>{project.displayName}</h2>
            <p>
              This public page is generated from the project&apos;s managed
              Orrylo Project Profile rather than maintained as a separate source
              of truth.
            </p>
            <div className="project-public-links">
              {websiteUrl ? (
                <a
                  href={websiteUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Website ↗
                </a>
              ) : null}
              {communityUrl ? (
                <a
                  href={communityUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Community ↗
                </a>
              ) : null}
            </div>
          </article>

          <article className="project-public-card project-public-metadata-card">
            <span className="project-public-section-kicker">
              Metadata context
            </span>
            <h2>Separate from this landing page</h2>
            <p>
              Orrylo keeps public-page routing separate from Stellar metadata
              hosting. This public page does not prove that stellar.toml has
              been published.
            </p>
            <dl>
              <div>
                <dt>Public page</dt>
                <dd>{`/p/${project.slug}`}</dd>
              </div>
              <div>
                <dt>Expected metadata home</dt>
                <dd>{project.metadataHome ?? "Not configured"}</dd>
              </div>
              <div>
                <dt>TOML status</dt>
                <dd>Not published by this prototype</dd>
              </div>
            </dl>
          </article>
        </section>

        <section className="project-public-stellar">
          <span className="project-public-section-kicker">
            Built on Stellar
          </span>
          <h2>
            Fast, open infrastructure for a project that can keep growing.
          </h2>
          <p>
            Orrylo manages the project presentation layer while preserving the
            underlying Stellar asset identity and verifiable network state.
          </p>
          <a href="https://stellar.org" target="_blank" rel="noreferrer">
            Learn about Stellar ↗
          </a>
        </section>
      </main>

      <footer className="project-public-footer">
        <div>
          <strong>Orrylo</strong>
          <span>Project infrastructure for Stellar.</span>
        </div>
        <Link href="/create">Build your project →</Link>
      </footer>
    </div>
  );
}
