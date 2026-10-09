"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { makeJprVersion } from "../actions";

// Makes the JPR version of a resume already on file (new uploads get one automatically), or, with redoOf,
// throws away a JPR version that came out wrong and makes it again from the original.
// autoAfter (the file's upload time): when the automatic JPR version should long be done (15 minutes) and isn't,
// start it on its own when the page opens, once per browser session so a file that can't be done isn't retried
// on every visit.
export function JprButton({
  resumeId,
  candidateId,
  redoOf,
  autoAfter,
}: {
  resumeId: string;
  candidateId: string;
  redoOf?: string;
  autoAfter?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fired = useRef(false);
  useEffect(() => {
    if (!autoAfter || fired.current || Date.now() - new Date(autoAfter).getTime() < 15 * 60_000) return;
    fired.current = true;
    const key = `jpr-auto-${resumeId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // no storage: still make it once for this page view
    }
    start(async () => {
      const r = await makeJprVersion(resumeId, candidateId);
      setMsg({ ok: r.ok, text: r.message });
    });
  }, [autoAfter, resumeId, candidateId]);
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
