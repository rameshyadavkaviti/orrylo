"use client";

import { useState } from "react";

import type {
  PublishManagedProjectFailure,
  PublishManagedProjectSuccess,
} from "../lib/projects/managed-project-api";

export function PublishProjectControl({
  projectId,
}: {
  projectId: string;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "publishing" }
    | { status: "failure"; message: string }
  >({ status: "idle" });

  async function publish() {
    setState({ status: "publishing" });

    try {
      const response = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        credentials: "same-origin",
      });
      const result = await readJson<
        PublishManagedProjectSuccess | PublishManagedProjectFailure
      >(response);

      if (!response.ok || !result?.ok) {
        setState({
          status: "failure",
          message:
            result && !result.ok && result.code === "unauthenticated"
              ? "Reconnect your owner wallet before publishing."
              : "The landing page could not be published right now.",
        });
        return;
      }

      window.location.reload();
    } catch {
      setState({
        status: "failure",
        message: "The landing page could not be published right now.",
      });
    }
  }

  return (
    <div className="managed-project-action">
      <button
        className="button button-primary"
        type="button"
        disabled={state.status === "publishing"}
        onClick={() => void publish()}
      >
        {state.status === "publishing"
          ? "Publishing page…"
          : "Publish public landing page"}
      </button>
      <small>
        This publishes the Orrylo landing page only. It does not issue a Stellar
        asset or publish stellar.toml.
      </small>
      {state.status === "failure" ? (
        <span className="field-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
