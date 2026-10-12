import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { TestnetIssuanceSection } from "../../../components/testnet-issuance-section";
import { SESSION_COOKIE_NAME } from "../../../lib/auth/constants";
import { getWalletAuthService } from "../../../lib/auth/runtime";
import { getDatabaseClient } from "../../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../../lib/server/persistence/project-profile-repository";
import { TestnetIssuanceService } from "../../../lib/server/projects/testnet-issuance-service";

/**
 * Additive layout: PR #19 owns the managed-project page and metadata rendering.
 * This route adds issuance status independently, without changing its components.
 */
export default async function ManagedAssetIssuanceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = await getWalletAuthService().getSession(token);
  if (!session) redirect("/my-assets");

  const { projectId } = await params;
  const sql = getDatabaseClient();
  const project = await new PostgresProjectProfileRepository(sql).findOwnedById(
    projectId,
    session.publicKey,
  );
  if (!project) notFound();

  const service = new TestnetIssuanceService(sql, { network: project.network });
  const issuance = await service.getOwnedStatus(projectId, session.publicKey);
  return (
    <>
      {children}
      <div className="page-stack" style={{ marginTop: "1.5rem" }}>
        <TestnetIssuanceSection
          project={project}
          issuance={issuance}
          intentConfigurationAvailable={Boolean(process.env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY)}
        />
      </div>
    </>
  );
}
