"use client";

import { useState, useTransition } from "react";
import { sendText, type OutreachResult } from "@/app/(app)/outreach-actions";

// Text back a number that isn't on file yet, from JPR's number, without adding them first.
export function UnknownReply({ to, name }: { to: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [result, setResult] = useState<OutreachResult | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" className="btn-quiet py-1 text-xs" onClick={() => setOpen(true)}>
        Text back
      </button>
    );
  return (
    <form
      className="mt-2 w-full space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData();
        form.set("to", to);
        form.set("name", name);
        form.set("body", body);
        form.set("path", "/messages");
        start(async () => {
          const r = await sendText(form);
          setResult(r);
          if (r.ok) setBody("");
        });
      }}
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        autoFocus
        placeholder={`Text ${name} from JPR's number`}
        className="field w-full"
      />
      <div className="flex items-center gap-2">
        <button className="btn py-1 text-xs" disabled={pending || !body.trim()}>
          {pending ? "Sending…" : "Send"}
        </button>
        <button type="button" className="btn-quiet py-1 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {result && <span className={`text-xs ${result.ok ? "text-mint" : "text-rose"}`}>{result.message}</span>}
      </div>
    </form>
  );
}
