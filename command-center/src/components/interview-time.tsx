"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setInterviewTime } from "@/app/(app)/pipeline-actions";
import { interviewWhen } from "@/lib/format";

// The interview date and time on a candidate's job tab: shown at a glance, typed in or changed by hand.
function localValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InterviewTime({ cjId, at, details }: { cjId: string; at: string | null; details: string | null }) {
  const [editing, setEditing] = useState(!at);
  const [value, setValue] = useState(() => localValue(at));
  const [note, setNote] = useState(details ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const save = () =>
    start(async () => {
      if (!value) return setMsg("Pick a date and time.");
      const r = await setInterviewTime(cjId, new Date(value).toISOString(), note);
      setMsg(r.ok ? null : r.message);
      if (r.ok) {
        setEditing(false);
        router.refresh();
      }
    });

  return (
    <div id="interview" className="flex w-full scroll-mt-20 flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
      <span className="font-mono text-[11px] uppercase tracking-wider text-faint">Interview</span>
      {!editing && at ? (
        <>
          <span className="font-medium text-amber">{interviewWhen(at)}</span>
          {details && <span className="text-muted">{details}</span>}
          <button type="button" onClick={() => setEditing(true)} className="link text-sm">
            Change
          </button>
        </>
      ) : (
        <>
          <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} className="field w-auto py-1" />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Where / with whom (optional)"
            className="field w-auto min-w-48 flex-1 py-1"
          />
          <button type="button" onClick={save} disabled={pending} className="btn py-1">
            {pending ? "Saving…" : "Save"}
          </button>
          {at && (
            <button type="button" onClick={() => setEditing(false)} className="btn-quiet py-1">
              Cancel
            </button>
          )}
        </>
      )}
      {msg && <span className="text-rose">{msg}</span>}
    </div>
  );
}
