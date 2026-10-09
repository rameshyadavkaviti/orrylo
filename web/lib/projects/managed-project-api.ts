export interface CreateManagedProjectRequest {
  idempotencyKey: string;
  code: string;
  displayName: string;
  description: string;
}

export interface CreateManagedProjectSuccess {
  ok: true;
  created: boolean;
  projectId: string;
  slug: string;
  managePath: string;
  publicPath: string;
  publicStatus: "draft" | "published";
}

export type CreateManagedProjectFailureCode =
  | "untrusted_origin"
  | "unauthenticated"
  | "invalid_request"
  | "invalid_project"
  | "invalid_idempotency_key"
  | "idempotency_conflict"
  | "slug_unavailable"
  | "database_failure";

export interface CreateManagedProjectFailure {
  ok: false;
  code: CreateManagedProjectFailureCode;
}

export interface PublishManagedProjectSuccess {
  ok: true;
  publicStatus: "published";
  publicPath: string;
}

export type PublishManagedProjectFailureCode =
  | "untrusted_origin"
  | "unauthenticated"
  | "invalid_request"
  | "project_not_found"
  | "database_failure";

export interface PublishManagedProjectFailure {
  ok: false;
  code: PublishManagedProjectFailureCode;
}

export function parseCreateManagedProjectRequest(
  input: unknown,
): CreateManagedProjectRequest | null {
  if (!isRecord(input)) {
    return null;
  }

  if (
    typeof input.idempotencyKey !== "string" ||
    typeof input.code !== "string" ||
    typeof input.displayName !== "string" ||
    typeof input.description !== "string"
  ) {
    return null;
  }

  if (
    input.idempotencyKey.length > 128 ||
    input.code.length > 64 ||
    input.displayName.length > 160 ||
    input.description.length > 1024
  ) {
    return null;
  }

  return {
    idempotencyKey: input.idempotencyKey,
    code: input.code,
    displayName: input.displayName,
    description: input.description,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
