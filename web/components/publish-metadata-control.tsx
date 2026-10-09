"use client";

import { useState } from "react";

import type { PublishMetadataResponse } from "../lib/projects/metadata-publication-api";

export function PublishMetadataControl({
  projectId,
  enabled,
  hasPublication,
  needsUpdate,
  reachable,
}: {
  projectId: string;
  enabled: boolean;
  hasPublication: boolean;
  needsUpdate: boolean;
  reachable: boolean;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "publishing" }
    | { status: "failure"; message: string }
  >({ status: "idle" });

  const label = !hasPublication
    ? "Publish metadata"
    : needsUpdate
      ? "Publish updated metadata"
      : reachable
        ? "Metadata verified"
        : "Retry verification";

  async function publish() {
    if (!enabled || state.status === "publishing") {
      return;
    }

    setState({ status: "publishing" });

    try {
      const response = await fetch(
        `/api/projects/${projectId}/metadata/publish`,
        {
          method: "POST",
          credentials: "same-origin",
        },
      );
      const result = await readJson<PublishMetadataResponse>(response);

      if (response.ok && result?.ok) {
        window.location.reload();
        return;
      }

      setState({
        status: "failure",
        message: describeFailure(result),
      });
    } catch {
      setState({
        status: "failure",
        message:
          "Metadata publication could not be completed. The current Project Profile is unchanged.",
      });
    }
  }

  return (
    <div className="metadata-publication-action">
      <button
        type="button"
        className="button button-primary"
        disabled={!enabled || (hasPublication && reachable && !needsUpdate)}
        onClick={() => void publish()}
      >
        {state.status === "publishing" ? "Publishing…" : label}
      </button>
      {!enabled ? (
        <small>
          Resolve the publication blockers above before publishing metadata.
        </small>
      ) : null}
      {state.status === "failure" ? (
        <small className="field-error" role="alert">
          {state.message}
        </small>
      ) : null}
    </div>
  );
}

function describeFailure(
  result: PublishMetadataResponse | null,
): string {
  if (!result || result.ok) {
    return "Metadata publication could not be completed.";
  }

  switch (result.code) {
    case "verification_failed":
      return "The metadata snapshot was published in Orrylo, but the canonical HTTPS endpoint could not be verified yet. Retry after assets.orrylo.com is routed to the deployed service.";
    case "unauthenticated":
      return "Reconnect the owner wallet before publishing metadata.";
    case "project_not_found":
      return "This project is not available to the current wallet.";
    case "unsupported_issuer_model":
      return "Dedicated Issuer metadata publication is not configured yet.";
    case "unsupported_network":
      return "This publication flow is Testnet-only.";
    case "not_ready":
      return "The project is missing required metadata or a verified issuer link.";
    case "asset_identity_conflict":
      return "Another published project already uses this asset code and issuer identity.";
    case "publication_superseded":
      return "Project metadata changed while verification was running. Review the latest state and publish again.";
    case "untrusted_origin":
      return "Metadata publication is not configured for this site address.";
    case "invalid_request":
    case "database_failure":
      return "Metadata publication could not be completed.";
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
