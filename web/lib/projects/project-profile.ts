export type ProjectIssuerModel = "shared" | "dedicated";
export type ProjectNetwork = "testnet" | "public";
export type ProjectPublicStatus = "draft" | "published";

export interface ProjectProfile {
  projectId: string;
  slug: string;
  assetCode: string;
  displayName: string;
  description: string | null;
  category: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  communityUrl: string | null;
  metadataHome: string | null;
  issuerModel: ProjectIssuerModel;
  network: ProjectNetwork;
  issuerPublicKey: string | null;
  explorerUrl: string | null;
  publicStatus: ProjectPublicStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedProjectProfile extends ProjectProfile {
  ownerPublicKey: string;
}

const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidProjectSlug(slug: string): boolean {
  return (
    slug.length > 0 && slug.length <= 63 && PROJECT_SLUG_PATTERN.test(slug)
  );
}

export function isValidProjectId(projectId: string): boolean {
  return PROJECT_ID_PATTERN.test(projectId);
}

export function projectPublicPath(slug: string): string {
  if (!isValidProjectSlug(slug)) {
    throw new Error("Invalid project slug.");
  }

  return `/p/${slug}`;
}

export function projectManagePath(projectId: string): string {
  if (!isValidProjectId(projectId)) {
    throw new Error("Invalid project ID.");
  }

  return `/my-assets/${projectId}`;
}
