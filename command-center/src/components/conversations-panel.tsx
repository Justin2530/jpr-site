import Link from "next/link";
import { Chip, Empty, Panel } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { convOf, subjectOf, whoKey, whoPath, type MsgRow } from "@/lib/messages";

export type ConvRow = MsgRow & {
  id: string;
  summary: string;
  body: string | null;
  direction: string | null;
  occurred_at: string;
  about?: string | null;
};

// Each conversation with one person, newest first, split the same way Messages splits them (one per email
// thread, texts per job or per candidate), so a tap opens just that conversation.
export function ConversationsPanel({
  rows,
  sole = new Map(),
  label = (r) => (r.kind === "text" ? "Texts" : "Emails"),
  empty,
}: {
  rows: ConvRow[];
  sole?: Map<string, string>;
  label?: (r: ConvRow) => string;
  empty: string;
}) {
  const list = new Map<string, { path: string; topic: string; about: string | null; last: ConvRow; count: number }>();
  for (const r of rows) {
    const w = convOf(r, sole);
    const key = whoKey(w);
    const hit = list.get(key);
    if (hit) {
      hit.count++;
      continue;
    }
    const subject = r.kind === "email" ? subjectOf(r)?.replace(/^((re|fwd?):\s*)+/gi, "") : null;
    list.set(key, { path: whoPath(w), topic: subject ? `✉ ${subject}` : label(r), about: r.about ?? null, last: r, count: 1 });
  }
  return (
    <Panel title={`Conversations · ${list.size}`}>
      {list.size === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="-my-1 divide-y divide-line">
          {[...list.values()].map((v) => (
            <li key={v.path}>
              <Link href={v.path} className="flex items-center gap-3 py-2.5 transition hover:bg-white/[0.03]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {v.topic}
                    {v.about && <span className="text-muted"> · {v.about}</span>}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {v.last.direction === "out" ? "You: " : ""}
                    {(v.last.body ?? v.last.summary).replace(/\s+/g, " ").slice(0, 140)}
                  </p>
                </div>
                {v.last.direction === "in" && <Chip tone="amber">They wrote last</Chip>}
                <span className="shrink-0 font-mono text-[10.5px] text-faint">
                  {v.count} · {timeAgo(v.last.occurred_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
