import type {
  EditableProjectMetadataInput,
  ProjectMetadataErrors,
} from "./project-metadata";

export interface UpdateProjectMetadataSuccess {
  ok: true;
  projectId: string;
  updatedAt: string;
}

export type UpdateProjectMetadataFailureCode =
  | "untrusted_origin"
  | "unauthenticated"
  | "invalid_request"
  | "invalid_metadata"
  | "project_not_found"
  | "database_failure";

export interface UpdateProjectMetadataFailure {
  ok: false;
  code: UpdateProjectMetadataFailureCode;
  fieldErrors?: ProjectMetadataErrors;
}

export type UpdateProjectMetadataResponse =
  UpdateProjectMetadataSuccess | UpdateProjectMetadataFailure;

export type UpdateProjectMetadataRequest = EditableProjectMetadataInput;
