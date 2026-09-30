"use client";

import { useState } from "react";
import { ChatIcon, MailIcon, PhoneIcon } from "@/components/icons";
import type { CorrItem } from "@/lib/correspondence";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "call", label: "Calls" },
  { key: "text", label: "Texts" },
  { key: "email", label: "Emails" },
] as const;

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}
function clock(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// Every call, text and email by date. Click one to read the whole thing.
export function Correspondence({ items, person }: { items: CorrItem[]; person?: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const count = (k: string) =>
    k === "all" ? items.length : items.filter((i) => (k === "call" ? i.kind === "call" || i.kind === "ai_call" : i.kind === k)).length;
  const shown = items.filter(
    (i) => filter === "all" || (filter === "call" ? i.kind === "call" || i.kind === "ai_call" : i.kind === filter),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-md border px-2.5 py-1 text-xs ${filter === f.key ? "border-cyan/50 bg-cyan-soft text-cyan" : "border-line text-muted hover:text-ink"}`}
          >
            {f.label} <span className="font-mono text-faint">{count(f.key)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
          Nothing here yet. Use Call, Text or Email above and it gets saved here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((i) => {
            const Icon = i.kind === "text" ? ChatIcon : i.kind === "email" ? MailIcon : PhoneIcon;
            const hasMore = Boolean(i.body || i.transcript?.length);
            return (
              <li key={`${i.kind}-${i.id}`}>
                <details className="group rounded-lg border border-line open:border-cyan/30 open:bg-white/[0.02]">
                  <summary className={`flex list-none items-start gap-3 px-3 py-2.5 ${hasMore ? "cursor-pointer" : "cursor-default"}`}>
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${i.kind === "ai_call" ? "text-cyan" : "text-muted"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {i.summary}
                        {i.context && <span className="text-muted"> · {i.context}</span>}
                      </p>
                      <p className="font-mono text-[10.5px] text-faint">
                        {when(i.at)}
                        {i.direction && ` · ${i.direction === "in" ? "incoming" : "outgoing"}`}
                        {i.duration != null && ` · ${clock(i.duration)}`}
                        {i.by && ` · ${i.by}`}
                      </p>
                    </div>
                    {hasMore && <span className="shrink-0 text-xs text-cyan group-open:hidden">Read</span>}
                  </summary>
                  {hasMore && (
                    <div className="border-t border-line px-3 py-3">
                      {i.body && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{i.body}</p>}
                      {i.transcript && i.transcript.length > 0 && (
                        <ol className={`max-h-[26rem] space-y-2 overflow-auto ${i.body ? "mt-3 border-t border-line pt-3" : ""}`}>
                          {i.transcript.map((l, n) => (
                            <li key={n} className={`flex gap-2 ${l.speaker === "candidate" ? "flex-row-reverse text-right" : ""}`}>
                              <div
                                className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${l.speaker === "agent" ? "border border-cyan/25 bg-cyan-soft" : "border border-line bg-white/[0.03]"}`}
                              >
                                <p className="panel-title mb-0.5 text-[10px]">
                                  {l.speaker === "agent" ? "JPR assistant" : (person ?? "Candidate")}
                                </p>
                                {l.text}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
