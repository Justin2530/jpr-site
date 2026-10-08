"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import type { Tone } from "@/lib/format";

export type BoardColumn = { key: string; label: string; tone?: Tone };
export type BoardCard = {
  id: string;
  column: string;
  title: string;
  href: string;
  sub?: string;
  meta?: string;
  badge?: string;
  badgeTone?: Tone;
  flag?: boolean;
};

const EDGE: Record<Tone, string> = {
  cyan: "bg-cyan",
  amber: "bg-amber",
  mint: "bg-mint",
  rose: "bg-rose",
  muted: "bg-faint",
};

// Kanban board. Drag a card to another column (or use its menu on touch screens) to move it.
export function Board({
  columns,
  cards,
  move,
  footer,
}: {
  columns: BoardColumn[];
  cards: BoardCard[];
  move: (id: string, column: string) => Promise<void>;
  footer?: Record<string, string>;
}) {
  const [optimistic, setOptimistic] = useOptimistic(cards, (state, m: { id: string; column: string }) =>
    state.map((c) => (c.id === m.id ? { ...c, column: m.column } : c)),
  );
  const [, start] = useTransition();

  const moveCard = (id: string, column: string) => {
    start(async () => {
      setOptimistic({ id, column });
      await move(id, column);
    });
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6">
      <div className="flex min-w-max gap-3">
        {columns.map((col) => {
          const items = optimistic.filter((c) => c.column === col.key);
          return (
            <section
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/plain");
                if (id) moveCard(id, col.key);
              }}
              className="flex w-64 shrink-0 flex-col rounded-xl border border-line bg-deep/60"
            >
              <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${EDGE[col.tone ?? "cyan"]}`} />
                  <span className="panel-title text-ink/80">{col.label}</span>
                </span>
                <span className="readout text-xs text-muted">{items.length}</span>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                {items.map((c) => (
                  <article
                    key={c.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                    className="group cursor-grab rounded-lg border border-line bg-panel-solid p-2.5 transition hover:border-line-strong active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={c.href} className="link text-sm font-medium leading-snug">
                        {c.title}
                      </Link>
                      {c.flag && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose" title="Needs attention" />}
                    </div>
                    {c.sub && <p className="mt-0.5 truncate text-xs text-muted">{c.sub}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[10.5px] text-faint">{c.meta}</span>
                      <select
                        value={c.column}
                        onChange={(e) => moveCard(c.id, e.target.value)}
                        aria-label={`Move ${c.title}`}
                        className="max-w-24 rounded border border-line bg-deep px-1 py-0.5 font-mono text-[10px] text-muted opacity-70 group-hover:opacity-100"
                      >
                        {columns.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {c.badge && <p className={`readout mt-1 text-xs ${c.badgeTone === "muted" ? "text-muted" : "text-cyan"}`}>{c.badge}</p>}
                  </article>
                ))}
              </div>
              {footer?.[col.key] && <footer className="border-t border-line px-3 py-2 font-mono text-[11px] text-muted">{footer[col.key]}</footer>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
