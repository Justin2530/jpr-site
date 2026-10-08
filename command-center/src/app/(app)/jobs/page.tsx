import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { ChevronIcon, PlusIcon } from "@/components/icons";
import { label, timeAgo } from "@/lib/format";
import { Board } from "@/components/board";
import { FilterTabs, ViewSwitcher } from "@/components/view-switcher";
import { moveJob } from "./actions";

export const metadata = { title: "Jobs · JPR" };

const ACTIVE = ["applied", "sourced", "assigned", "contacting", "conversation", "ready_to_submit", "submitted", "interviewing", "offer"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; view?: string }> }) {
  const params = await searchParams;
  const status = params.status ?? "open";
  // "companies" starts every company collapsed; "expanded" opens them all.
  const view = params.view === "board" || params.view === "expanded" ? params.view : "companies";
  const { supabase } = await requireStaff();
  const [{ data: allJobs, error }, { data: clients }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, status, priority, location, opened_on, companies(id, name, status), candidate_jobs(stage)")
      .order("priority")
      .order("opened_on", { ascending: false }),
    supabase.from("companies").select("id, name, status").eq("status", "client"),
  ]);
  if (error) throw new Error(error.message);
  const jobs = view === "board" || status === "all" ? allJobs : (allJobs ?? []).filter((j) => j.status === status);

  // Company first, then its jobs. Every client (and every company with any job) always gets a row,
  // even when the current filter hides all of its jobs, so no company silently disappears.
  type Group = { id: string; name: string; status: string; jobs: NonNullable<typeof allJobs>; total: Map<string, number> };
  const groups = new Map<string, Group>();
  const groupFor = (id: string, name: string, st: string) => {
    if (!groups.has(id)) groups.set(id, { id, name, status: st, jobs: [], total: new Map() });
    return groups.get(id)!;
  };
  for (const c of clients ?? []) groupFor(c.id, c.name, c.status);
  for (const j of allJobs ?? []) {
    const g = groupFor(j.companies?.id ?? "none", j.companies?.name ?? "No company", j.companies?.status ?? "");
    g.total.set(j.status, (g.total.get(j.status) ?? 0) + 1);
  }
  for (const j of jobs ?? []) groups.get(j.companies?.id ?? "none")!.jobs.push(j);
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
                { key: "companies", label: "Companies" },
                { key: "expanded", label: "Companies + jobs" },
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
      {byCompany.length === 0 ? (
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
        <div className="space-y-3">
          {byCompany.map((g) => {
            const count = (fn: (stage: string) => boolean) =>
              g.jobs.reduce((n, j) => n + j.candidate_jobs.filter((cj) => fn(cj.stage)).length, 0);
            const active = count((st) => ACTIVE.includes(st));
            const ready = count((st) => st === "ready_to_submit");
            const initials = g.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase();
            const other = [...g.total.entries()]
              .filter(([st]) => status !== "all" && st !== status)
              .map(([st, n]) => `${n} ${label(st).toLowerCase()}`)
              .join(" · ");
            return (
              <details
                key={g.id}
                id={`co-${g.id}`}
                open={view === "expanded"}
                className="group panel scroll-mt-24 overflow-hidden border-l-4 border-l-cyan/60"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 bg-gradient-to-r from-cyan/[0.08] to-transparent px-4 py-3 transition hover:from-cyan/[0.14] group-open:border-b group-open:border-line [&::-webkit-details-marker]:hidden">
                  <ChevronIcon className="h-5 w-5 shrink-0 -rotate-90 text-cyan transition group-open:rotate-0" />
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-cyan/40 bg-cyan-soft font-mono text-sm font-semibold text-cyan">
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold">{g.name}</p>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
                      {[g.status && label(g.status), other && `also ${other}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex gap-5 text-center font-mono text-[10.5px] uppercase tracking-wider text-faint">
                    <span>
                      <span className="readout block text-xl text-ink">{g.jobs.length}</span>
                      {status === "all" ? "" : `${label(status).toLowerCase()} `}
                      {g.jobs.length === 1 ? "job" : "jobs"}
                    </span>
                    <span>
                      <span className="readout block text-xl text-ink">{active}</span>active
                    </span>
                    <span>
                      <span className={`readout block text-xl ${ready ? "text-amber" : "text-ink"}`}>{ready}</span>to submit
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {g.id !== "none" && (
                      <Link href={`/companies/${g.id}`} className="btn-quiet text-xs">
                        Company
                      </Link>
                    )}
                    <Link href={`/jobs/new?company=${g.id}`} className="btn-quiet text-xs">
                      <PlusIcon className="h-3.5 w-3.5" /> Job
                    </Link>
                  </div>
                </summary>
                {g.jobs.length === 0 ? (
                  <p className="px-4 py-4 pl-8 text-sm text-muted">
                    No {status === "all" ? "" : `${label(status).toLowerCase()} `}jobs{other ? ` (${other})` : ""}.
                  </p>
                ) : (
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
                )}
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
