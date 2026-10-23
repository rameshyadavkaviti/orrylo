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
import { PostgresMainnetCreationStore } from "../../../lib/server/projects/mainnet-creation-store";
import {
  createServerMainnetPublicationService,
  PostgresMainnetPublicationBackend,
} from "../../../lib/server/projects/mainnet-publication-service";
import { TestnetIssuanceService } from "../../../lib/server/projects/testnet-issuance-service";
import {
  MAINNET_SHARED_ISSUER_PUBLIC_KEY,
  MAINNET_TREASURY_PUBLIC_KEY,
} from "../../../lib/stellar/mainnet-creation";

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

  let mainnetOrder = null;
  let issuance = null;
  if (project.network === "public") {
    try {
      mainnetOrder = await new PostgresMainnetCreationStore(sql).getOwned(
        projectId,
        session.publicKey,
      );
    } catch {
      // Missing Mainnet state is shown as a draft, never as issued.
    }
  } else {
    issuance = await new TestnetIssuanceService(sql, {
      network: project.network,
      approvedIssuerPublicKey:
        process.env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY,
    }).getOwnedStatus(projectId, session.publicKey);
  }

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

  if (mainnetOrder?.status === "issued") {
    try {
      await createServerMainnetPublicationService(sql).reconcile(
        projectId,
        session.publicKey,
      );
      project =
        (await projectRepository.findOwnedById(projectId, session.publicKey)) ??
        project;
      mainnetOrder =
        (await new PostgresMainnetCreationStore(sql).getOwned(
          projectId,
          session.publicKey,
        )) ?? mainnetOrder;
    } catch {
      // Issuance stays final. The page reports publication pending/failed.
    }
  }

  let publication = null;
  try {
    publication = project.network === "public"
      ? await new PostgresMainnetPublicationBackend(sql).getPublication(
          projectId,
          session.publicKey,
        )
      : await createServerMetadataPublicationRepository(sql).getByProjectId(
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
      mainnetOrder={mainnetOrder}
      mainnetActivationEnabled={
        project.network === "public" &&
        process.env.ORRYLO_MAINNET_CREATION_ENABLED === "true" &&
        process.env.ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY ===
          MAINNET_SHARED_ISSUER_PUBLIC_KEY &&
        process.env.ORRYLO_MAINNET_TREASURY_PUBLIC_KEY ===
          MAINNET_TREASURY_PUBLIC_KEY &&
        process.env.ORRYLO_MAINNET_TREASURY_VERIFIED === "true" &&
        Boolean(process.env.ORRYLO_MAINNET_ISSUER_FEE_STROOPS) &&
        Boolean(process.env.ORRYLO_MAINNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS) &&
        Boolean(process.env.ORRYLO_MAINNET_SIGNER_PRIVATE_URL) &&
        Boolean(process.env.ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET)
      }
      intentConfigurationAvailable={
        project.network === "testnet" &&
        Boolean(process.env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY) &&
        Boolean(process.env.ORRYLO_TESTNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS)
      }
    />
  );
}
