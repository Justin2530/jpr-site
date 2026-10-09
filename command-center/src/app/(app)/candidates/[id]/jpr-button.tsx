"use client";

import { useState, useTransition } from "react";
import { makeJprVersion } from "../actions";

// Makes the JPR version of a resume already on file (new uploads get one automatically).
export function JprButton({ resumeId, candidateId }: { resumeId: string; candidateId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="block">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await makeJprVersion(resumeId, candidateId);
            setMsg({ ok: r.ok, text: r.message });
          })
        }
        className="text-xs text-cyan hover:underline disabled:opacity-60"
      >
        {pending ? "Making the JPR version… (about a minute)" : "Make JPR version"}
      </button>
      {msg && <span className={`block text-xs ${msg.ok ? "text-mint" : "text-amber"}`}>{msg.text}</span>}
    </span>
  );
}
