"use client";

import { useState, useTransition } from "react";
import { makeJprVersion } from "../actions";

// Makes the JPR version of a resume already on file (new uploads get one automatically), or, with redoOf,
// throws away a JPR version that came out wrong and makes it again from the original.
export function JprButton({ resumeId, candidateId, redoOf }: { resumeId: string; candidateId: string; redoOf?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="block">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (redoOf && !confirm("Throw this JPR version away and make it again from the original?")) return;
            const r = await makeJprVersion(resumeId, candidateId, redoOf);
            setMsg({ ok: r.ok, text: r.message });
          })
        }
        className="text-xs text-cyan hover:underline disabled:opacity-60"
      >
        {pending ? "Making the JPR version… (about a minute)" : redoOf ? "Redo" : "Make JPR version"}
      </button>
      {msg && <span className={`block text-xs ${msg.ok ? "text-mint" : "text-amber"}`}>{msg.text}</span>}
    </span>
  );
}
