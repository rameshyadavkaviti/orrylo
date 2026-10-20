import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { ManagedProjectView } from "../../../components/managed-project-view";
import { SESSION_COOKIE_NAME } from "../../../lib/auth/constants";
import { getWalletAuthService } from "../../../lib/auth/runtime";
import { getDatabaseClient } from "../../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../../lib/server/persistence/project-profile-repository";
import {
  createServerAutomaticPublicationService,
  createServerMetadataPublicationRepository,
} from "../../../lib/server/projects/automatic-publication-service";
import { TestnetIssuanceService } from "../../../lib/server/projects/testnet-issuance-service";

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
  let project = await projectRepository.findOwnedById(
    projectId,
    session.publicKey,
  );

  if (!project) {
    notFound();
  }

  const issuance = await new TestnetIssuanceService(sql, {
    network: project.network,
    approvedIssuerPublicKey:
      process.env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY,
  }).getOwnedStatus(projectId, session.publicKey);

  if (issuance?.status === "confirmed") {
    try {
      await createServerAutomaticPublicationService(
        sql,
      ).reconcileConfirmedProject(projectId, session.publicKey);
      project =
        (await projectRepository.findOwnedById(projectId, session.publicKey)) ??
        project;
    } catch {
      // Issuance stays confirmed. The page below reports publication pending.
    }
  }

  let publication = null;
  try {
    publication =
      await createServerMetadataPublicationRepository(sql).getByProjectId(
        projectId,
      );
  } catch {
    // Missing publication runtime configuration is shown as pending, not issued.
  }

  return (
    <ManagedProjectView
      project={project}
      publication={publication}
      issuance={issuance}
      intentConfigurationAvailable={
        project.network === "testnet" &&
        Boolean(process.env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY) &&
        Boolean(process.env.ORRYLO_TESTNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS)
      }
    />
  );
}
