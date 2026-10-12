import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectLandingPage } from "../../../components/project-landing-page";
import { getDatabaseClient } from "../../../lib/server/persistence/database";
import { PostgresMetadataPublicationRepository } from "../../../lib/server/persistence/metadata-publication-repository";
import { PostgresProjectProfileRepository } from "../../../lib/server/persistence/project-profile-repository";
import { PostgresSharedAssetProvenanceReader } from "../../../lib/server/projects/shared-asset-provenance";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: ProjectPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = await findProject(slug);

  if (!project) {
    return { title: "Project not found — Orrylo" };
  }

  return {
    title: `${project.displayName} (${project.assetCode}) — Orrylo`,
    description:
      project.description ??
      `${project.displayName} is a Stellar project published with Orrylo.`,
  };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { slug } = await params;
  const project = await findProject(slug);

  if (!project) {
    notFound();
  }

  const publicationRepository = new PostgresMetadataPublicationRepository(
    getDatabaseClient(),
  );
  const publication = await publicationRepository.getByProjectId(
    project.projectId,
  );
  // Public profile presentation cannot infer issuer authority from mutable
  // project_profiles. The issuer is shown only when durable proof matches.
  const [owner] = await getDatabaseClient()<
    {
      owner_public_key: string;
    }[]
  >`
    SELECT owner_public_key FROM project_profile_owners
    WHERE project_id = ${project.projectId}
  `;
  const provenance = owner
    ? await new PostgresSharedAssetProvenanceReader(
        getDatabaseClient(),
      ).findConfirmed(project.projectId, owner.owner_public_key.trim())
    : null;
  const trustedIssuer =
    provenance?.assetCode === project.assetCode &&
    provenance.network === project.network &&
    (project.issuerPublicKey === null ||
      project.issuerPublicKey === provenance.issuerPublicKey)
      ? provenance.issuerPublicKey
      : null;
  return (
    <ProjectLandingPage
      project={{ ...project, issuerPublicKey: trustedIssuer }}
      metadataPublication={trustedIssuer ? publication : null}
    />
  );
}

async function findProject(slug: string) {
  const repository = new PostgresProjectProfileRepository(getDatabaseClient());
  return repository.findPublishedBySlug(slug);
}
