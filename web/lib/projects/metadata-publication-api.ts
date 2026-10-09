export type PublishMetadataFailureCode =
  | "untrusted_origin"
  | "unauthenticated"
  | "invalid_request"
  | "project_not_found"
  | "unsupported_issuer_model"
  | "unsupported_network"
  | "not_ready"
  | "asset_identity_conflict"
  | "publication_superseded"
  | "verification_failed"
  | "database_failure";

export interface PublishMetadataSuccess {
  ok: true;
  changed: boolean;
  published: true;
  reachable: true;
  endpoint: string;
  contentHash: string;
  revision: number;
  verifiedAt: string;
}

export interface PublishMetadataFailure {
  ok: false;
  code: PublishMetadataFailureCode;
  published?: boolean;
  reachable?: boolean;
  endpoint?: string;
  contentHash?: string;
  revision?: number;
  verificationErrorCode?: string | null;
}

export type PublishMetadataResponse =
  PublishMetadataSuccess | PublishMetadataFailure;
