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
                { key: "list", label: "List by company" },
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
      ) : view === "list" ? (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Job", "Company", "Status", "Active", "To submit", "Placed", "Opened"].map((h) => (
                  <th key={h} className="panel-title px-4 py-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            {byCompany.map((g) => (
              <tbody key={g.id} className="divide-y divide-line border-t-2 border-line-strong">
                <tr className="bg-white/[0.03]">
                  <td colSpan={7} className="px-4 py-2">
                    <Link href={`/companies/${g.id}`} className="link font-semibold">
                      {g.name}
                    </Link>
                    <span className="ml-2 font-mono text-[11px] text-faint">
                      {g.jobs.length} {g.jobs.length === 1 ? "job" : "jobs"}
                    </span>
                  </td>
                </tr>
                {g.jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <Link href={`/jobs/${j.id}`} className="link font-medium">
                        {j.title}
                      </Link>
                      {j.priority === 1 && <span className="ml-2 text-xs text-amber">High</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{j.companies?.name}</td>
                    <td className="px-4 py-2.5">
                      <Chip tone={j.status === "open" ? "cyan" : "muted"}>{label(j.status)}</Chip>
                    </td>
                    <td className="readout px-4 py-2.5">{j.candidate_jobs.filter((cj) => ACTIVE.includes(cj.stage)).length}</td>
                    <td className="readout px-4 py-2.5 text-amber">
                      {j.candidate_jobs.filter((cj) => cj.stage === "ready_to_submit").length}
                    </td>
                    <td className="readout px-4 py-2.5 text-mint">{j.candidate_jobs.filter((cj) => cj.stage === "placed").length}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-faint">{timeAgo(j.opened_on)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : (
        <div className="space-y-8">
          {byCompany.map((g) => {
            const active = g.jobs.reduce((n, j) => n + j.candidate_jobs.filter((cj) => ACTIVE.includes(cj.stage)).length, 0);
            const ready = g.jobs.reduce((n, j) => n + j.candidate_jobs.filter((cj) => cj.stage === "ready_to_submit").length, 0);
            return (
              <section key={g.id}>
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
                  <Link href={`/companies/${g.id}`} className="text-lg font-semibold hover:text-cyan">
                    {g.name}
                  </Link>
                  {g.status && <Chip tone={g.status === "client" ? "mint" : "muted"}>{label(g.status)}</Chip>}
                  <span className="font-mono text-xs text-muted">
                    <span className="readout text-ink">{g.jobs.length}</span> {g.jobs.length === 1 ? "job" : "jobs"} ·{" "}
                    <span className="readout text-ink">{active}</span> active
                    {ready > 0 && (
                      <>
                        {" · "}
                        <span className="readout text-amber">{ready}</span> to submit
                      </>
                    )}
                  </span>
                  <Link href={`/jobs/new?company=${g.id}`} className="ml-auto text-xs text-cyan">
                    <PlusIcon className="inline h-3.5 w-3.5" /> Job
                  </Link>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {g.jobs.map((j) => {
                    const active = j.candidate_jobs.filter((cj) => ACTIVE.includes(cj.stage)).length;
                    const ready = j.candidate_jobs.filter((cj) => cj.stage === "ready_to_submit").length;
                    const placed = j.candidate_jobs.filter((cj) => cj.stage === "placed").length;
                    return (
                      <Link key={j.id} href={`/jobs/${j.id}`} className="panel block p-4 transition hover:border-line-strong">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{j.title}</p>
                            <p className="truncate text-sm text-muted">{j.location}</p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            {j.priority === 1 && <Chip tone="amber">High</Chip>}
                            <Chip tone={j.status === "open" ? "cyan" : "muted"}>{label(j.status)}</Chip>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 font-mono text-[11px] uppercase tracking-wider text-faint">
                          <span>
                            <span className="readout block text-lg text-ink">{active}</span>active
                          </span>
                          <span>
                            <span className="readout block text-lg text-amber">{ready}</span>to submit
                          </span>
                          <span>
                            <span className="readout block text-lg text-mint">{placed}</span>placed
                          </span>
                        </div>
                        <p className="mt-2 font-mono text-[10.5px] text-faint">Opened {timeAgo(j.opened_on)}</p>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
