import { cookies } from "next/headers";
import Link from "next/link";
import { DeleteDraftButton } from "../../components/delete-draft-button";

import { SESSION_COOKIE_NAME } from "../../lib/auth/constants";
import { getWalletAuthService } from "../../lib/auth/runtime";
import { projectManagePath } from "../../lib/projects/project-profile";
import { getDatabaseClient } from "../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../lib/server/persistence/project-profile-repository";
import {
  createServerAutomaticPublicationService,
  createServerMetadataPublicationRepository,
} from "../../lib/server/projects/automatic-publication-service";
import { TestnetIssuanceService } from "../../lib/server/projects/testnet-issuance-service";

export const dynamic = "force-dynamic";

export async function MyAssetsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getWalletAuthService().getSession(token);

  if (!session) {
    return (
      <div className="page-stack">
        <div className="page-heading">
          <span className="eyebrow">My Assets</span>
          <h1>Your token projects.</h1>
          <p>
            Build anonymously first. Connect your wallet only when you want to
            save and manage a Project Profile.
          </p>
        </div>
        <div className="empty-state">
          <strong>Connect your wallet to view managed projects</strong>
          <p>
            Wallet authentication identifies project ownership. It does not
            create or sign a Stellar transaction.
          </p>
          <a className="button button-secondary" href="#wallet-connect">
            Connect Wallet
          </a>
        </div>
      </div>
    );
  }

  const sql = getDatabaseClient();
  const repository = new PostgresProjectProfileRepository(sql);
  const projects = await repository.listOwnedByWallet(session.publicKey);
  const publicationRepository = (() => {
    try {
      return createServerMetadataPublicationRepository(sql);
    } catch {
      return null;
    }
  })();
  const automaticPublication = (() => {
    try {
      return createServerAutomaticPublicationService(sql);
    } catch {
      return null;
    }
  })();
  const projectStates = await Promise.all(
    projects.map(async (project) => {
      const issuance = await new TestnetIssuanceService(sql, {
        network: project.network,
        approvedIssuerPublicKey:
          process.env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY,
      }).getOwnedStatus(project.projectId, session.publicKey);
      if (issuance?.status === "confirmed" && automaticPublication) {
        try {
          await automaticPublication.reconcileConfirmedProject(
            project.projectId,
            session.publicKey,
          );
        } catch {
          // Issuance remains confirmed; the status below stays pending/failed.
        }
      }
      let publication = null;
      if (publicationRepository) {
        try {
          publication = await publicationRepository.getByProjectId(
            project.projectId,
          );
        } catch {
          // A status read failure must not hide other issued projects.
        }
      }
      return { project, issuance, publication };
    }),
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">My Assets</span>
        <h1>Your managed Orrylo projects.</h1>
        <p>
          Manage saved drafts and projects from your connected wallet. Check a
          project&apos;s transaction evidence to confirm whether a token was issued.
        </p>
      </div>

      {projectStates.length === 0 ? (
        <div className="empty-state">
          <strong>No managed projects yet</strong>
          <p>
            Configure a token anonymously, then save it when you are ready to
            keep managing it with Orrylo.
          </p>
          <Link className="button button-primary" href="/create">
            Create Token
          </Link>
        </div>
      ) : (
        <section
          className="card-grid asset-project-grid"
          aria-label="Your projects"
        >
          {projectStates.map(({ project, issuance, publication }) => {
            const issued = issuance?.status === "confirmed";
            const metadataVerified = Boolean(
              publication?.reachable && publication.verifiedAt,
            );
            return (
              <article
                className="surface-card managed-project-card"
                key={project.projectId}
              >
                <div className="card-title-row">
                  <div>
                    <span className="eyebrow">{project.assetCode}</span>
                    <h2>{project.displayName}</h2>
                  </div>
                  <div>
                    <span className="availability-badge">
                      {issued ? "Issued" : "Draft"}
                    </span>
                    {issued ? (
                      <span className="availability-badge">
                        {metadataVerified
                          ? "Metadata Verified"
                          : "Metadata Pending / Failed"}
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="muted">
                  {project.description ?? "Managed Stellar project profile."}
                </p>
                <small className="project-hint">
                  A draft status does not indicate whether on-chain issuance has
                  completed. Open the project to review transaction evidence.
                </small>
                <div className="project-card-actions">
                  <Link
                    className="button button-primary"
                    href={projectManagePath(project.projectId)}
                  >
                    View project <span aria-hidden="true">↗</span>
                  </Link>
                  {!issued && project.publicStatus === "draft" ? (
                    <DeleteDraftButton
                      projectId={project.projectId}
                      projectName={project.displayName}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

export default MyAssetsPage;
