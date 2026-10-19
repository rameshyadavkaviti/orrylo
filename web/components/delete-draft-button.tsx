"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteDraftButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove draft "${projectName}" from My Assets? Published or issuance-linked projects cannot be removed.`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/archive`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("This draft could not be removed. It may have an active trustline, issuance request, or publication.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove draft.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="draft-delete-action">
      <button type="button" className="button button-secondary" onClick={() => void remove()} disabled={busy}>
        {busy ? "Removing…" : "Delete draft"}
      </button>
      {error ? <small role="alert" className="field-error">{error}</small> : null}
    </div>
  );
}
