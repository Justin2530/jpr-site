"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { deleteJobs, setJobsStatus } from "./actions";

// Checkboxes on the Jobs list (Justin 2026-10-11: delete jobs "without clicking into them", even with people in process).
type Job = { id: string; title: string; inProcess: number; placed: number };
const Ctx = createContext<{
  on: Set<string>;
  toggle: (id: string) => void;
} | null>(null);

export function JobBulk({
  jobs,
  owner,
  children,
}: {
  jobs: Job[];
  owner: boolean;
  children: ReactNode;
}) {
  const [on, setOn] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toggle = (id: string) =>
    setOn((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const picked = jobs.filter((j) => on.has(j.id));
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.message);
      if (r.ok) {
        setOn(new Set());
        router.refresh();
      }
    });
  const remove = () => {
    const people = picked.reduce((n, j) => n + j.inProcess, 0);
    const placed = picked.reduce((n, j) => n + j.placed, 0);
    const warn = [
      people &&
        `${people} ${people === 1 ? "person is" : "people are"} in process and will come off ${picked.length === 1 ? "it" : "them"} and any automation for them stops.`,
      placed &&
        `${placed} placement record${placed === 1 ? "" : "s"} will be deleted too.`,
    ]
      .filter(Boolean)
      .join("\n");
    const ok = window.confirm(
      `Delete ${picked.length === 1 ? "this job" : `these ${picked.length} jobs`}?\n\n${picked.map((j) => j.title).join("\n")}\n\n${warn ? warn + "\n" : ""}Texts, emails and calls stay on each person's record. This can't be undone.`,
    );
    if (ok) run(() => deleteJobs(picked.map((j) => j.id)));
  };

  return (
    <Ctx.Provider value={{ on, toggle }}>
      {(picked.length > 0 || msg) && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan/40 bg-panel-solid px-3 py-2 text-sm backdrop-blur">
          {picked.length > 0 && (
            <>
              <span className="text-ink">{picked.length} selected</span>
              <select
                value=""
                disabled={pending}
                onChange={(e) =>
                  e.target.value &&
                  run(() =>
                    setJobsStatus(
                      picked.map((j) => j.id),
                      e.target.value,
                    ),
                  )
                }
                className="field w-auto py-1 text-sm"
              >
                <option value="">Change status…</option>
                <option value="open">Open</option>
                <option value="on_hold">On hold</option>
                <option value="filled">Filled</option>
                <option value="closed">Closed</option>
              </select>
              {owner && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={remove}
                  className="btn-quiet text-rose"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setOn(new Set())}
                className="btn-quiet"
              >
                Clear
              </button>
            </>
          )}
          {msg && (
            <span className="text-muted">{pending ? "Working…" : msg}</span>
          )}
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

export function JobCheck({ id, label }: { id: string; label: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      checked={ctx.on.has(id)}
      onChange={() => ctx.toggle(id)}
      className="h-4 w-4 shrink-0 accent-cyan"
    />
  );
}
