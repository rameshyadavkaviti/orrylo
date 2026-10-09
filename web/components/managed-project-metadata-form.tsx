"use client";

import { type FormEvent, useState } from "react";

import type {
  UpdateProjectMetadataFailure,
  UpdateProjectMetadataResponse,
} from "../lib/projects/managed-project-metadata-api";
import {
  type EditableProjectMetadataInput,
  type ProjectMetadataErrors,
  validateEditableProjectMetadata,
} from "../lib/projects/project-metadata";

export function ManagedProjectMetadataForm({
  projectId,
  initial,
}: {
  projectId: string;
  initial: EditableProjectMetadataInput;
}) {
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<ProjectMetadataErrors>({});
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "failure"; message: string }
  >({ status: "idle" });

  function update(field: keyof EditableProjectMetadataInput, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setState({ status: "idle" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateEditableProjectMetadata(fields);
    setErrors(validation.errors);

    if (!validation.valid) {
      setState({
        status: "failure",
        message: "Review the highlighted metadata fields before saving.",
      });
      return;
    }

    setState({ status: "saving" });

    try {
      const response = await fetch(`/api/projects/${projectId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(fields),
      });
      const result = await readJson<UpdateProjectMetadataResponse>(response);

      if (!response.ok || !result?.ok) {
        const failure =
          result && !result.ok
            ? result
            : ({ ok: false, code: "database_failure" } as const);

        if (failure.code === "invalid_metadata" && failure.fieldErrors) {
          setErrors(failure.fieldErrors);
        }

        setState({
          status: "failure",
          message: describeFailure(failure),
        });
        return;
      }

      window.location.reload();
    } catch {
      setState({
        status: "failure",
        message:
          "Project metadata could not be saved right now. Your edits remain in this form.",
      });
    }
  }

  return (
    <form className="surface-card metadata-editor" onSubmit={submit} noValidate>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Project metadata</span>
          <h2>Configure the presentation fields Orrylo can safely manage.</h2>
        </div>
        <span className="availability-badge">Owner only</span>
      </div>

      <div className="metadata-editor-grid">
        <label className="field">
          <span>Display name</span>
          <input
            value={fields.displayName}
            onChange={(event) => update("displayName", event.target.value)}
            maxLength={41}
          />
          {errors.displayName ? (
            <small className="field-error">{errors.displayName}</small>
          ) : (
            <small>
              Editable presentation name; asset code stays unchanged.
            </small>
          )}
        </label>

        <label className="field metadata-editor-wide">
          <span>Description</span>
          <textarea
            value={fields.description}
            onChange={(event) => update("description", event.target.value)}
            maxLength={281}
            rows={4}
          />
          {errors.description ? (
            <small className="field-error">{errors.description}</small>
          ) : (
            <small>Up to 280 characters.</small>
          )}
        </label>

        <label className="field">
          <span>Durable logo URL</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://..."
            value={fields.logoUrl}
            onChange={(event) => update("logoUrl", event.target.value)}
          />
          {errors.logoUrl ? (
            <small className="field-error">{errors.logoUrl}</small>
          ) : (
            <small>
              HTTPS only. Browser-local builder images cannot be persisted here.
            </small>
          )}
        </label>

        <label className="field">
          <span>Project website</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://..."
            value={fields.websiteUrl}
            onChange={(event) => update("websiteUrl", event.target.value)}
          />
          {errors.websiteUrl ? (
            <small className="field-error">{errors.websiteUrl}</small>
          ) : (
            <small>Optional HTTPS project URL.</small>
          )}
        </label>

        <label className="field">
          <span>Community link</span>
          <input
            type="url"
            inputMode="url"
            placeholder="https://..."
            value={fields.communityUrl}
            onChange={(event) => update("communityUrl", event.target.value)}
          />
          {errors.communityUrl ? (
            <small className="field-error">{errors.communityUrl}</small>
          ) : (
            <small>
              One generic project/community URL; no social-network schema is
              introduced here.
            </small>
          )}
        </label>
      </div>

      <div className="form-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={state.status === "saving"}
        >
          {state.status === "saving" ? "Saving metadata…" : "Save metadata"}
        </button>
      </div>

      {state.status === "failure" ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function describeFailure(failure: UpdateProjectMetadataFailure): string {
  switch (failure.code) {
    case "unauthenticated":
      return "Reconnect the owner wallet before saving metadata.";
    case "project_not_found":
      return "This project is not available to the current wallet.";
    case "invalid_metadata":
    case "invalid_request":
      return "Review the metadata fields and try again.";
    case "untrusted_origin":
      return "Metadata saving is not configured for this site address.";
    case "database_failure":
      return "Project metadata could not be saved right now.";
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
