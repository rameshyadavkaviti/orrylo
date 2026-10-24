import { cookies } from "next/headers";
import Link from "next/link";
import { DeleteDraftButton } from "../../components/delete-draft-button";
import { WalletAuthControl } from "../../components/wallet-auth-control";

import { SESSION_COOKIE_NAME } from "../../lib/auth/constants";
import { getWalletAuthService } from "../../lib/auth/runtime";
import { projectManagePath } from "../../lib/projects/project-profile";
import { getDatabaseClient } from "../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../lib/server/persistence/project-profile-repository";
import {
  createServerAutomaticPublicationService,
  createServerMetadataPublicationRepository,
} from "../../lib/server/projects/automatic-publication-service";
import { PostgresMainnetCreationStore } from "../../lib/server/projects/mainnet-creation-store";
import {
  createServerMainnetPublicationService,
  PostgresMainnetPublicationBackend,
} from "../../lib/server/projects/mainnet-publication-service";
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
          <h1>Your assets, all in one place.</h1>
          <p>
            Connect the wallet associated with your projects to see saved drafts,
            issuance progress and verified results.
          </p>
        </div>
        <section className="my-assets-welcome" aria-labelledby="my-assets-connect-heading">
          <div className="my-assets-welcome-copy">
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2 id="my-assets-connect-heading">Pick up where you left off.</h2>
            <p>Sign in with Albedo to view projects associated with your wallet. Connecting does not authorize a payment or an on-chain transaction.</p>
            <div className="my-assets-connect-actions">
              <WalletAuthControl connectLabel="Connect with Albedo" />
              <Link href="/create-token" className="button button-secondary">Explore asset creation ↗</Link>
            </div>
          </div>
          <ol className="my-assets-welcome-steps" aria-label="How your workspace works">
            <li><span>01</span><div><strong>Connect</strong><small>Use the wallet linked to your projects</small></div></li>
            <li><span>02</span><div><strong>Continue</strong><small>Resume drafts or pending steps</small></div></li>
            <li><span>03</span><div><strong>Verify</strong><small>Review confirmed ledger evidence</small></div></li>
          </ol>
        </section>
      </div>
    );
  }

  const sql = getDatabaseClient();
  const repository = new PostgresProjectProfileRepository(sql);
  const projects = await repository.listOwnedByWallet(session.publicKey);
  const mainnetStore = new PostgresMainnetCreationStore(sql);
  const mainnetPublication = new PostgresMainnetPublicationBackend(sql);
  const mainnetReconciliation = createServerMainnetPublicationService(sql);
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
      if (project.network === "public") {
        let mainnetOrder = null;
        let publication = null;
        let currentProject = project;
        try {
          mainnetOrder = await mainnetStore.getOwned(
            project.projectId,
            session.publicKey,
          );
          if (mainnetOrder?.status === "issued") {
            try {
              await mainnetReconciliation.reconcile(
                project.projectId,
                session.publicKey,
              );
            } catch {
              // Issuance is final; publication remains independently retryable.
            }
            currentProject =
              (await repository.findOwnedById(
                project.projectId,
                session.publicKey,
              )) ?? project;
          }
          publication = await mainnetPublication.getPublication(
            project.projectId,
            session.publicKey,
          );
        } catch {
          // Missing migration/config is reported as pending without inventing issuance.
        }
        return {
          project: currentProject,
          issuance: null,
          mainnetOrder,
          publication,
        };
      }
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
      return { project, issuance, mainnetOrder: null, publication };
    }),
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">My Assets</span>
        <h1>Your asset workspace.</h1>
        <p>
          Continue a draft, follow an in-progress creation, or review verified
          issuance and publication. Projects remain tied to your wallet.
        </p>
      </div>

      <div className="my-assets-toolbar">
        <div className="my-assets-wallet-summary"><span className="eyebrow">CONNECTED WALLET</span><code title={session.publicKey}>{session.publicKey.slice(0, 8)}…{session.publicKey.slice(-6)}</code></div>
        <Link href="/create-token" className="button button-primary">Create new asset ↗</Link>
      </div>

      {projectStates.length === 0 ? (
        <div className="empty-state">
          <strong>Your workspace is ready.</strong>
          <p>
            You haven&apos;t saved a project with this wallet yet. Start by
            designing your first Stellar asset.
          </p>
          <Link className="button button-primary" href="/create-token">
            Create Asset
          </Link>
        </div>
      ) : (
        <section className="my-assets-projects" aria-labelledby="my-assets-projects-heading">
          <div className="my-assets-section-heading">
            <div><span className="eyebrow">YOUR PROJECTS</span><h2 id="my-assets-projects-heading">Saved assets <span className="my-assets-count">{projectStates.length}</span></h2></div>
            <p>Open a project to continue or inspect its latest verified state.</p>
          </div>
          <div className="card-grid asset-project-grid">
          {projectStates.map(({ project, issuance, mainnetOrder, publication }) => {
            const issued =
              issuance?.status === "confirmed" || mainnetOrder?.status === "issued";
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
                      {issued ? "Issued" : mainnetOrder ? "In progress" : "Draft / Pending"}
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
                  {project.description ?? "Stellar asset project"}
                </p>
                <div className="my-assets-project-meta">
                  <span>{project.network === "public" ? "Mainnet" : "Testnet"}</span>
                  <span>{issued ? "On-chain issuance confirmed" : "Open to check current progress"}</span>
                </div>
                <div className="project-card-actions">
                  <Link
                    className="button button-primary"
                    href={projectManagePath(project.projectId)}
                  >
                    {issued ? "View asset" : "Continue project"} <span aria-hidden="true">↗</span>
                  </Link>
                  {!issued && !mainnetOrder && project.publicStatus === "draft" ? (
                    <DeleteDraftButton
                      projectId={project.projectId}
                      projectName={project.displayName}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
          </div>
        </section>
      )}
    </div>
  );
}

export default MyAssetsPage;
