import Link from "next/link";

import type { MetadataPublicationState } from "../lib/projects/metadata-publication";
import { buildMetadataReadiness } from "../lib/projects/metadata-readiness";
import {
  type ManagedProjectProfile,
  projectPublicPath,
} from "../lib/projects/project-profile";
import { ManagedProjectMetadataForm } from "./managed-project-metadata-form";
import { PublishMetadataControl } from "./publish-metadata-control";
import { PublishProjectControl } from "./publish-project-control";

export function ManagedProjectView({
  project,
  publication = null,
}: {
  project: ManagedProjectProfile;
  publication?: MetadataPublicationState | null;
}) {
  const publicPath = projectPublicPath(project.slug);
  const published = project.publicStatus === "published";
  const readiness = buildMetadataReadiness(project, publication);
  const metadataBadge = !readiness.publicationReady
    ? "Needs attention"
    : readiness.toml.publishedContentCurrent
      ? readiness.toml.reachable
        ? "Metadata verified"
        : "Published · verify pending"
      : readiness.toml.published
        ? "Update available"
        : "Ready to publish";

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">Managed Project</span>
        <h1>{project.displayName}</h1>
        <p>
          This is the persisted Orrylo Project Profile for{" "}
          <strong>{project.assetCode}</strong>. Project identity, public
          presentation, Stellar metadata hosting, and on-chain execution remain
          separate concerns.
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
          <h2>{published ? "Public page live" : "Private landing draft"}</h2>
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
              <dt>Metadata home</dt>
              <dd>{project.metadataHome ?? "Not configured"}</dd>
            </div>
            <div>
              <dt>Metadata endpoint</dt>
              <dd>
                <code>{readiness.toml.endpoint}</code>
              </dd>
            </div>
            <div>
              <dt>TOML publication</dt>
              <dd>
                {readiness.toml.published
                  ? readiness.toml.publishedContentCurrent
                    ? "Published"
                    : "Published · update available"
                  : "Not published"}
              </dd>
            </div>
            <div>
              <dt>TOML reachability</dt>
              <dd>{readiness.toml.reachable ? "Verified" : "Not verified"}</dd>
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

      <ManagedProjectMetadataForm
        projectId={project.projectId}
        initial={{
          displayName: project.displayName,
          description: project.description ?? "",
          logoUrl: project.logoUrl ?? "",
          websiteUrl: project.websiteUrl ?? "",
          communityUrl: project.communityUrl ?? "",
        }}
      />

      <section className="surface-card readiness-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Metadata publication readiness</span>
            <h2>What is ready, published, reachable, or still missing?</h2>
          </div>
          <span className="availability-badge">{metadataBadge}</span>
        </div>

        <div className="readiness-grid">
          {readiness.items.map((item) => (
            <article key={item.key} className="readiness-item">
              <div className="readiness-item-heading">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>

        {readiness.blockers.length > 0 ? (
          <p className="readiness-note">
            Publication blockers remain. Resolve the required fields above
            before attempting Shared Issuer Testnet publication.
          </p>
        ) : null}

        {readiness.toml.content ? (
          <div className="toml-preview">
            <div>
              <span className="eyebrow">Generated stellar.toml</span>
              <strong>
                {readiness.toml.publishedContentCurrent
                  ? "Matches published revision"
                  : "Current Project Profile"}
              </strong>
            </div>
            <pre>{readiness.toml.content}</pre>
            <small>
              Generated: yes · Published:{" "}
              {readiness.toml.published ? "yes" : "no"} · Reachable:{" "}
              {readiness.toml.reachable ? "yes" : "no"} · Explorer visibility:
              unverified
            </small>
            <small>
              Canonical endpoint: <code>{readiness.toml.endpoint}</code>
            </small>
            {readiness.toml.verifiedAt ? (
              <small>
                Last successful verification: {readiness.toml.verifiedAt}
              </small>
            ) : null}
            <PublishMetadataControl
              projectId={project.projectId}
              enabled={readiness.publicationReady}
              hasPublication={readiness.toml.published}
              needsUpdate={
                readiness.toml.published &&
                !readiness.toml.publishedContentCurrent
              }
              reachable={readiness.toml.reachable}
            />
          </div>
        ) : null}

        <p className="readiness-note">
          The Orrylo landing page at <code>{publicPath}</code> is not the
          stellar.toml host. Metadata publication also does not create a Stellar
          asset, authorize a trustline, or prove explorer visibility.
        </p>
      </section>

      <section className="prototype-boundary">
        <div>
          <span className="eyebrow">Execution boundary</span>
          <strong>Metadata publication is not token issuance.</strong>
        </div>
        <p>
          The wallet association controls this Project Profile and its metadata
          publication action. Stellar asset creation, issuer configuration,
          home_domain changes, trustline authorization, signing, RYLO
          operations, and Soroban execution remain separate boundaries.
        </p>
      </section>
    </div>
  );
}
