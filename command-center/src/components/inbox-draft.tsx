"use client";

import { useState, useTransition } from "react";
import { sendInboxDraft, skipInboxDraft } from "@/app/(app)/inbox-actions";

type Result = { ok: boolean; message: string } | null;

// A reply the third eye drafted to a candidate's question. Nothing goes out until Send.
export function InboxDraft({
  id,
  body: initial,
}: {
  id: string;
  body: string;
}) {
  const [body, setBody] = useState(initial);
  const [pending, run] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const act = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    run(async () => {
      setResult(null);
      setResult(await fn());
    });
  return (
    <div className="mt-2 space-y-2">
      <textarea
        className="field min-h-24 text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={pending || result?.ok}
        aria-label="Drafted reply"
      />
      {!result?.ok && (
        <div className="flex gap-2">
          <button
            className="btn px-3 py-1 text-xs"
            disabled={pending}
            onClick={() => act(() => sendInboxDraft({ id, body }))}
          >
            Send
          </button>
          <button
            className="btn-quiet px-3 py-1 text-xs hover:text-rose"
            disabled={pending}
            onClick={() => act(() => skipInboxDraft(id))}
          >
            Don&apos;t send
          </button>
        </div>
      )}
      {result && (
        <p className={`text-sm ${result.ok ? "text-mint" : "text-rose"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
