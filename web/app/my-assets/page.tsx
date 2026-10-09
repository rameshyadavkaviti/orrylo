import { cookies } from "next/headers";
import Link from "next/link";

import { SESSION_COOKIE_NAME } from "../../lib/auth/constants";
import { getWalletAuthService } from "../../lib/auth/runtime";
import { projectManagePath } from "../../lib/projects/project-profile";
import { getDatabaseClient } from "../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../lib/server/persistence/project-profile-repository";

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
          <h1>Your managed Orrylo projects.</h1>
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

  const repository = new PostgresProjectProfileRepository(getDatabaseClient());
  const projects = await repository.listOwnedByWallet(session.publicKey);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">My Assets</span>
        <h1>Your managed Orrylo projects.</h1>
        <p>
          These records are persistent Project Profiles associated with your
          verified wallet. They are not proof that a Stellar asset has already
          been issued.
        </p>
      </div>

      {projects.length === 0 ? (
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
        <section className="card-grid">
          {projects.map((project) => (
            <article className="surface-card managed-project-card" key={project.projectId}>
              <div className="card-title-row">
                <div>
                  <span className="eyebrow">{project.assetCode}</span>
                  <h2>{project.displayName}</h2>
                </div>
                <span className="availability-badge">
                  {project.publicStatus === "published"
                    ? "Public page live"
                    : "Draft project"}
                </span>
              </div>
              <p className="muted">
                {project.description ?? "Managed Stellar project profile."}
              </p>
              <small>
                Metadata: not published · Stellar asset: not created
              </small>
              <Link
                className="button button-primary"
                href={projectManagePath(project.projectId)}
              >
                Manage project
              </Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

export default MyAssetsPage;
