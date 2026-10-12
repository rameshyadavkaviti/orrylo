import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { ManagedProjectView } from "../../../components/managed-project-view";
import { SESSION_COOKIE_NAME } from "../../../lib/auth/constants";
import { getWalletAuthService } from "../../../lib/auth/runtime";
import { getDatabaseClient } from "../../../lib/server/persistence/database";
import { PostgresMetadataPublicationRepository } from "../../../lib/server/persistence/metadata-publication-repository";
import { PostgresProjectProfileRepository } from "../../../lib/server/persistence/project-profile-repository";
import { PostgresSharedAssetProvenanceReader } from "../../../lib/server/projects/shared-asset-provenance";

export const dynamic = "force-dynamic";

interface ManagedProjectPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ManagedProjectPage({
  params,
}: ManagedProjectPageProps) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getWalletAuthService().getSession(token);

  if (!session) {
    redirect("/my-assets");
  }

  const { projectId } = await params;
  const sql = getDatabaseClient();
  const projectRepository = new PostgresProjectProfileRepository(sql);
  const project = await projectRepository.findOwnedById(
    projectId,
    session.publicKey,
  );

  if (!project) {
    notFound();
  }

  const publicationRepository = new PostgresMetadataPublicationRepository(sql);
  const publication = await publicationRepository.getByProjectId(projectId);
  const provenance = await new PostgresSharedAssetProvenanceReader(sql)
    .findConfirmed(projectId, session.publicKey);
  const trustedIssuer =
    provenance?.assetCode === project.assetCode &&
    provenance.network === project.network &&
    (project.issuerPublicKey === null ||
      project.issuerPublicKey === provenance.issuerPublicKey)
      ? provenance.issuerPublicKey
      : null;

  return (
    <ManagedProjectView
      project={{ ...project, issuerPublicKey: trustedIssuer }}
      publication={trustedIssuer ? publication : null}
    />
  );
}
