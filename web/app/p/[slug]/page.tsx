import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectLandingPage } from "../../../components/project-landing-page";
import { getDatabaseClient } from "../../../lib/server/persistence/database";
import { PostgresMetadataPublicationRepository } from "../../../lib/server/persistence/metadata-publication-repository";
import { PostgresProjectProfileRepository } from "../../../lib/server/persistence/project-profile-repository";

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

  return (
    <ProjectLandingPage
      project={project}
      metadataPublication={publication}
    />
  );
}

async function findProject(slug: string) {
  const repository = new PostgresProjectProfileRepository(getDatabaseClient());
  return repository.findPublishedBySlug(slug);
}
