"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCandidates } from "./actions";

type Row = { id: string; name: string; detail: string; added: string };

// The Candidates Select view: tick people and delete them together. A link can arrive with people already
// ticked (?pick=id,id) so a cleanup Claude lines up is one press for Justin.
export function SelectDelete({ rows, picked }: { rows: Row[]; picked: string[] }) {
  const [on, setOn] = useState(() => new Set(picked.filter((id) => rows.some((r) => r.id === id))));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const toggle = (id: string) =>
    setOn((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const names = rows.filter((r) => on.has(r.id)).map((r) => r.name);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!on.size || pending}
          onClick={() => {
            if (!window.confirm(`Delete ${on.size} ${on.size === 1 ? "person" : "people"} for good?\n\n${names.join("\n")}`)) return;
            start(async () => {
              const r = await deleteCandidates([...on]);
              setMsg(r.message);
              if (r.ok) {
                setOn(new Set());
                router.refresh();
              }
            });
          }}
          className="btn bg-rose/90 disabled:opacity-50"
        >
          {pending ? "Deleting…" : `Delete ${on.size || ""} selected`}
        </button>
        <button type="button" onClick={() => setOn(new Set())} className="btn-quiet" disabled={!on.size}>
          Clear
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
      <div className="panel divide-y divide-line">
        {rows.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]">
            <input type="checkbox" checked={on.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-cyan" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block truncate text-xs text-muted">{r.detail}</span>
            </span>
            <span className="font-mono text-[11px] text-faint">{r.added}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
