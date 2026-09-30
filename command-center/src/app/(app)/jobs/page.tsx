import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { label, timeAgo } from "@/lib/format";
import { Board } from "@/components/board";
import { FilterTabs, ViewSwitcher } from "@/components/view-switcher";
import { moveJob } from "./actions";

export const metadata = { title: "Jobs · JPR" };

const ACTIVE = ["assigned", "contacting", "conversation", "ready_to_submit", "submitted", "interviewing", "offer"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; view?: string }> }) {
  const { status = "open", view = "cards" } = await searchParams;
  const { supabase } = await requireStaff();
  let q = supabase
    .from("jobs")
    .select("id, title, status, priority, location, opened_on, companies(id, name, status), candidate_jobs(stage)")
    .order("priority")
    .order("opened_on", { ascending: false });
  if (status !== "all" && view !== "board") q = q.eq("status", status as "open");
  const { data: jobs, error } = await q;
  if (error) throw new Error(error.message);

  // Company first, then its jobs, so each client's openings read as one block.
  const groups = new Map<string, { id: string; name: string; status: string; jobs: NonNullable<typeof jobs> }>();
  for (const j of jobs ?? []) {
    const key = j.companies?.id ?? "none";
    if (!groups.has(key))
      groups.set(key, { id: key, name: j.companies?.name ?? "No company", status: j.companies?.status ?? "", jobs: [] });
    groups.get(key)!.jobs.push(j);
  }
  const byCompany = [...groups.values()].sort((a, b) => b.jobs.length - a.jobs.length || a.name.localeCompare(b.name));

  const tabs = [
    ["open", "Open"],
    ["on_hold", "On hold"],
    ["filled", "Filled"],
    ["closed", "Closed"],
    ["all", "All"],
  ] as const;

  return (
    <>
      <PageHeader
        kicker="Recruiting"
        title="Jobs"
        action={
          <div className="flex gap-2">
            <ViewSwitcher
              basePath="/jobs"
              current={view}
              params={{ status }}
              options={[
                { key: "cards", label: "By company" },
                { key: "board", label: "Board by status" },
              ]}
            />
            <Link href="/jobs/new" className="btn">
              <PlusIcon className="h-4 w-4" /> New job
            </Link>
          </div>
        }
      />
      {view !== "board" && (
        <div className="mb-4">
          <FilterTabs tabs={tabs} current={status} basePath="/jobs" paramName="status" params={{ view }} />
        </div>
      )}
      {(jobs ?? []).length === 0 ? (
        <Empty>No jobs here yet.</Empty>
      ) : view === "board" ? (
        <Board
          columns={[
            { key: "open", label: "Open", tone: "cyan" },
            { key: "on_hold", label: "On hold", tone: "amber" },
            { key: "filled", label: "Filled", tone: "mint" },
            { key: "closed", label: "Closed", tone: "muted" },
          ]}
          cards={jobs!.map((j) => ({
            id: j.id,
            column: j.status,
            title: j.title,
            href: `/jobs/${j.id}`,
            sub: j.companies?.name ?? undefined,
            meta: `${j.candidate_jobs.filter((cj) => ACTIVE.includes(cj.stage)).length} active · opened ${timeAgo(j.opened_on)}`,
            flag: j.priority === 1,
          }))}
          move={moveJob}
        />
      ) : (
        <>
          <nav className="mb-6 flex flex-wrap gap-2" aria-label="Jump to company">
            {byCompany.map((g) => (
              <a
                key={g.id}
                href={`#co-${g.id}`}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm transition hover:border-cyan/50"
              >
                <span className="max-w-[14rem] truncate">{g.name.replace(/^Sample: /, "")}</span>
                <span className="readout rounded bg-cyan-soft px-1.5 text-xs text-cyan">{g.jobs.length}</span>
              </a>
            ))}
          </nav>
          <div className="space-y-6">
            {byCompany.map((g) => {
              const count = (fn: (stage: string) => boolean) =>
                g.jobs.reduce((n, j) => n + j.candidate_jobs.filter((cj) => fn(cj.stage)).length, 0);
              const active = count((st) => ACTIVE.includes(st));
              const ready = count((st) => st === "ready_to_submit");
              const initials = g.name
                .replace(/^Sample: /, "")
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase();
              return (
                <section key={g.id} id={`co-${g.id}`} className="panel scroll-mt-24 overflow-hidden border-l-4 border-l-cyan/60">
                  <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-gradient-to-r from-cyan/[0.08] to-transparent px-4 py-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-cyan/40 bg-cyan-soft font-mono text-sm font-semibold text-cyan">
                      {initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/companies/${g.id}`} className="block truncate text-lg font-semibold hover:text-cyan">
                        {g.name}
                      </Link>
                      {g.status && <p className="font-mono text-[11px] uppercase tracking-wider text-muted">{label(g.status)}</p>}
                    </div>
                    <div className="flex gap-5 text-center font-mono text-[10.5px] uppercase tracking-wider text-faint">
                      <span>
                        <span className="readout block text-xl text-ink">{g.jobs.length}</span>
                        {g.jobs.length === 1 ? "job" : "jobs"}
                      </span>
                      <span>
                        <span className="readout block text-xl text-ink">{active}</span>active
                      </span>
                      <span>
                        <span className={`readout block text-xl ${ready ? "text-amber" : "text-ink"}`}>{ready}</span>to submit
                      </span>
                    </div>
                    <Link href={`/jobs/new?company=${g.id}`} className="btn-quiet text-xs">
                      <PlusIcon className="h-3.5 w-3.5" /> Job
                    </Link>
                  </header>
                  <ul className="divide-y divide-line">
                    {g.jobs.map((j) => {
                      const jActive = j.candidate_jobs.filter((cj) => ACTIVE.includes(cj.stage)).length;
                      const jReady = j.candidate_jobs.filter((cj) => cj.stage === "ready_to_submit").length;
                      const jPlaced = j.candidate_jobs.filter((cj) => cj.stage === "placed").length;
                      return (
                        <li key={j.id}>
                          <Link
                            href={`/jobs/${j.id}`}
                            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 pl-8 transition hover:bg-white/[0.03]"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{j.title}</p>
                              <p className="truncate text-sm text-muted">
                                {[j.location, `opened ${timeAgo(j.opened_on)}`].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            <div className="flex items-center gap-4 font-mono text-[11px] text-faint">
                              <span>
                                <span className="readout text-sm text-ink">{jActive}</span> active
                              </span>
                              <span>
                                <span className={`readout text-sm ${jReady ? "text-amber" : "text-ink"}`}>{jReady}</span> to submit
                              </span>
                              <span>
                                <span className="readout text-sm text-mint">{jPlaced}</span> placed
                              </span>
                            </div>
                            <div className="flex gap-1.5">
                              {j.priority === 1 && <Chip tone="amber">High</Chip>}
                              <Chip tone={j.status === "open" ? "cyan" : "muted"}>{label(j.status)}</Chip>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
