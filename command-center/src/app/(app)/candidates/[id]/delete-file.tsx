"use client";

import { useTransition } from "react";
import { deleteResume } from "../actions";

// Removes a file after a confirm. Deleting an original resume also removes its JPR version.
export function DeleteFile({ resumeId, candidateId, name, hasJpr }: { resumeId: string; candidateId: string; name: string; hasJpr: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title="Delete this file"
      aria-label="Delete this file"
      onClick={() => {
        if (!confirm(`Delete ${name}?${hasJpr ? " Its JPR version goes too." : ""}`)) return;
        start(() => deleteResume(resumeId, candidateId));
      }}
      className="shrink-0 px-1 text-faint hover:text-amber disabled:opacity-50"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
