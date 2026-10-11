"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Constants } from "@/lib/database.types";
import { STAGE_LABEL } from "@/lib/format";
import { bulkSetStage, bulkUnassign } from "@/app/(app)/pipeline-actions";
import { deleteCandidates } from "@/app/(app)/candidates/actions";

// Checkboxes on candidate lists with a bar of bulk actions (Justin 2026-10-11: "click some or all and take bulk
// actions... deleting or moving stage etc without clicking into candidate"). "job" rows are candidate-on-job
// links (move stage, remove from job, delete the people); "person" rows are candidates (delete).
type Item = { id: string; candidateId: string; name: string };
const Ctx = createContext<{
  on: Set<string>;
  toggle: (id: string) => void;
} | null>(null);

export function BulkList({
  kind,
  items,
  owner,
  children,
}: {
  kind: "job" | "person";
  items: Item[];
  owner: boolean;
  children: ReactNode;
}) {
  const [on, setOn] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState("");
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
  const picked = items.filter((i) => on.has(i.id));
  const all = items.length > 0 && picked.length === items.length;
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.message);
      if (r.ok) {
        setOn(new Set());
        setStage("");
        router.refresh();
      }
    });
  const names = picked.map((p) => p.name).join("\n");

  return (
    <Ctx.Provider value={{ on, toggle }}>
      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={all}
            onChange={() =>
              setOn(all ? new Set() : new Set(items.map((i) => i.id)))
            }
            className="h-4 w-4 accent-cyan"
          />
          {picked.length ? `${picked.length} selected` : "Select all"}
        </label>
        {picked.length > 0 && (
          <>
            {kind === "job" && (
              <>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="field w-auto py-1 pr-7 text-xs"
                  aria-label="Move to stage"
                >
                  <option value="">Move to stage…</option>
                  {Constants.public.Enums.pipeline_stage.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn py-1 text-xs disabled:opacity-50"
                  disabled={!stage || pending}
                  onClick={() => run(() => bulkSetStage([...on], stage))}
                >
                  Move
                </button>
                <button
                  type="button"
                  className="btn-quiet py-1 text-xs"
                  disabled={pending}
                  onClick={() =>
                    window.confirm(
                      `Take ${picked.length} off this job? They stay in Candidates.\n\n${names}`,
                    ) && run(() => bulkUnassign([...on]))
                  }
                >
                  Remove from job
                </button>
              </>
            )}
            {owner && (
              <button
                type="button"
                className="btn bg-rose/90 py-1 text-xs disabled:opacity-50"
                disabled={pending}
                onClick={() =>
                  window.confirm(
                    `Delete ${picked.length} ${picked.length === 1 ? "person" : "people"} from the system for good?\n\n${names}`,
                  ) &&
                  run(() =>
                    deleteCandidates([
                      ...new Set(picked.map((p) => p.candidateId)),
                    ]),
                  )
                }
              >
                Delete people
              </button>
            )}
            <button
              type="button"
              className="btn-quiet py-1 text-xs"
              onClick={() => setOn(new Set())}
            >
              Clear
            </button>
          </>
        )}
        {pending ? (
          <span className="text-faint">Working…</span>
        ) : (
          msg && <span className="text-muted">{msg}</span>
        )}
      </div>
      {children}
    </Ctx.Provider>
  );
}

export function BulkCheck({ id, label }: { id: string; label?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <input
      type="checkbox"
      checked={ctx.on.has(id)}
      onChange={() => ctx.toggle(id)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 shrink-0 cursor-pointer accent-cyan"
      aria-label={label ? `Select ${label}` : "Select"}
    />
  );
}
