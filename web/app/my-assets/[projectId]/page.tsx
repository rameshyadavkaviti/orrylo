import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { ManagedProjectView } from "../../../components/managed-project-view";
import { SESSION_COOKIE_NAME } from "../../../lib/auth/constants";
import { getWalletAuthService } from "../../../lib/auth/runtime";
import { getDatabaseClient } from "../../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../../lib/server/persistence/project-profile-repository";

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
  const repository = new PostgresProjectProfileRepository(getDatabaseClient());
  const project = await repository.findOwnedById(projectId, session.publicKey);

  if (!project) {
    notFound();
  }

  return <ManagedProjectView project={project} />;
}
