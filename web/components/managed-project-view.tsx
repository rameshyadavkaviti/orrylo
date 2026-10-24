import Link from "next/link";

import { TestnetIssuanceSection } from "./testnet-issuance-section";
import type { TestnetIssuanceRecord } from "../lib/server/projects/testnet-issuance-service";

import type { MetadataPublicationState } from "../lib/projects/metadata-publication";
import { buildMetadataReadiness } from "../lib/projects/metadata-readiness";
import {
  type ManagedProjectProfile,
  projectPublicPath,
} from "../lib/projects/project-profile";
import { ManagedProjectMetadataForm } from "./managed-project-metadata-form";
import { MainnetOrderControl } from "./mainnet-order-control";
import type { MainnetOrderRecord } from "../lib/server/projects/mainnet-creation-store";

export function ManagedProjectView({
  project,
  publication = null,
  issuance = null,
  mainnetOrder = null,
  intentConfigurationAvailable = false,
  mainnetActivationEnabled = false,
}: {
  project: ManagedProjectProfile;
  publication?: MetadataPublicationState | null;
  issuance?: TestnetIssuanceRecord | null;
  mainnetOrder?: MainnetOrderRecord | null;
  intentConfigurationAvailable?: boolean;
  mainnetActivationEnabled?: boolean;
}) {
  const publicPath = projectPublicPath(project.slug);
  const published = project.publicStatus === "published";
  const issued =
    issuance?.status === "confirmed" || mainnetOrder?.status === "issued";
  const readiness = buildMetadataReadiness(project, publication);
  const metadataBadge = !issued
    ? "Draft"
    : readiness.toml.publishedContentCurrent && readiness.toml.reachable
      ? "Metadata Verified"
      : "Metadata Pending / Failed";

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

      {mainnetOrder && mainnetOrder.status !== "issued" ? (
        <div id="creation-next-step" className="creation-project-next-step">
          <MainnetOrderControl initialOrder={mainnetOrder} activationEnabled={mainnetActivationEnabled} />
        </div>
      ) : null}
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
          <h2>
            {published
              ? "Public page live"
              : issued
                ? "Automatic publication pending"
                : "Private landing draft"}
          </h2>
          <dl className="managed-project-facts">
            <div>
              <dt>Project status</dt>
              <dd>{issued ? "Issued" : "Draft"}</dd>
            </div>
            <div>
              <dt>Landing-page status</dt>
              <dd>
                {published
                  ? "Published"
                  : issued
                    ? "Pending / Failed"
                    : "Draft"}
              </dd>
            </div>
            <div>
              <dt>Metadata status</dt>
              <dd>{metadataBadge}</dd>
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
              <dd>
                {issued
                  ? "Ledger verified"
                  : "Not confirmed"}
              </dd>
            </div>
          </dl>

          {published ? (
            <Link className="button button-primary" href={publicPath}>
              View public page
            </Link>
          ) : null}
        </article>
      </section>

      {project.network === "testnet" ? (
        <TestnetIssuanceSection
          project={project}
          issuance={issuance}
          intentConfigurationAvailable={intentConfigurationAvailable}
        />
      ) : mainnetOrder?.status === "issued" ? (
        <MainnetOrderControl initialOrder={mainnetOrder} activationEnabled={mainnetActivationEnabled} />
      ) : null}

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
            {issued
              ? "Automatic publication is pending or failed. Orrylo will retry safely without repeating token issuance."
              : "This draft remains private. Publication begins automatically only after confirmed Stellar issuance."}
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
          Confirmed issuance starts landing-page and metadata publication
          automatically. Publication retries never sign, submit, or replace a
          Stellar issuance. RYLO metadata remains on its separate namespace.
        </p>
      </section>
    </div>
  );
}
