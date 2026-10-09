import Link from "next/link";

import { buildMetadataReadiness } from "../lib/projects/metadata-readiness";
import {
  type ManagedProjectProfile,
  projectPublicPath,
} from "../lib/projects/project-profile";
import { PublishProjectControl } from "./publish-project-control";

export function ManagedProjectView({
  project,
}: {
  project: ManagedProjectProfile;
}) {
  const publicPath = projectPublicPath(project.slug);
  const published = project.publicStatus === "published";
  const readiness = buildMetadataReadiness(project);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">Managed Project</span>
        <h1>{project.displayName}</h1>
        <p>
          This is the persisted Orrylo Project Profile for{" "}
          <strong>{project.assetCode}</strong>. Project ownership, public
          routing, Stellar metadata hosting, and future on-chain execution
          remain separate concerns.
        </p>
      </div>

      <section className="managed-project-summary">
        <article className="surface-card">
          <span className="eyebrow">Project identity</span>
          <h2>{project.displayName}</h2>
          <dl className="managed-project-facts">
            <div>
              <dt>Asset code</dt>
              <dd>{project.assetCode}</dd>
            </div>
            <div>
              <dt>Project ID</dt>
              <dd>
                <code>{project.projectId}</code>
              </dd>
            </div>
            <div>
              <dt>Owner wallet</dt>
              <dd>
                <code>{project.ownerPublicKey}</code>
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{project.network}</dd>
            </div>
            <div>
              <dt>Issuer model</dt>
              <dd>
                {project.issuerModel === "shared"
                  ? "Orrylo Shared Issuer"
                  : "Dedicated Issuer"}
              </dd>
            </div>
          </dl>
        </article>

        <article className="surface-card">
          <span className="eyebrow">Publication</span>
          <h2>{published ? "Public page live" : "Private draft"}</h2>
          <dl className="managed-project-facts">
            <div>
              <dt>Landing-page status</dt>
              <dd>{published ? "Published" : "Draft"}</dd>
            </div>
            <div>
              <dt>Public page path</dt>
              <dd>
                <code>{publicPath}</code>
              </dd>
            </div>
            <div>
              <dt>Metadata context</dt>
              <dd>{project.metadataHome ?? "Not configured"}</dd>
            </div>
            <div>
              <dt>TOML publication</dt>
              <dd>Not published</dd>
            </div>
            <div>
              <dt>Stellar asset</dt>
              <dd>Not created</dd>
            </div>
          </dl>

          {published ? (
            <Link className="button button-primary" href={publicPath}>
              View public page
            </Link>
          ) : (
            <PublishProjectControl projectId={project.projectId} />
          )}
        </article>
      </section>

      <section className="surface-card readiness-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Publication readiness</span>
            <h2>What is ready, and what still needs infrastructure?</h2>
          </div>
          <span className="availability-badge">Truthful status only</span>
        </div>

        <div className="readiness-grid">
          {readiness.map((item) => (
            <article key={item.key} className="readiness-item">
              <div className="readiness-item-heading">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>

        <p className="readiness-note">
          Landing-page publication does not imply stellar.toml publication,
          issuer deployment, explorer verification, or Stellar asset creation.
        </p>
      </section>

      <section className="prototype-boundary">
        <div>
          <span className="eyebrow">What was saved?</span>
          <strong>A managed Orrylo project—not an on-chain asset.</strong>
        </div>
        <p>
          The wallet association proves who may manage this Project Profile.
          Asset issuance, issuer authorization, Stellar signing, TOML hosting,
          and any RYLO operations remain separate future execution boundaries.
        </p>
      </section>
    </div>
  );
}
