import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { label, timeAgo } from "@/lib/format";

export const metadata = { title: "Jobs · JPR" };

const ACTIVE = ["assigned", "contacting", "conversation", "ready_to_submit", "submitted", "interviewing", "offer"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "open" } = await searchParams;
  const { supabase } = await requireStaff();
  let q = supabase
    .from("jobs")
    .select("id, title, status, priority, location, opened_on, companies(name), candidate_jobs(stage)")
    .order("priority")
    .order("opened_on", { ascending: false });
  if (status !== "all") q = q.eq("status", status as "open");
  const { data: jobs, error } = await q;
  if (error) throw new Error(error.message);

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
        kicker="ATS"
        title="Jobs"
        action={
          <Link href="/jobs/new" className="btn">
            <PlusIcon className="h-4 w-4" /> New job
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([value, text]) => (
          <Link
            key={value}
            href={`/jobs?status=${value}`}
            className={`chip px-3 py-1 ${status === value ? "border-cyan/50 text-cyan" : "border-line text-muted hover:text-ink"}`}
          >
            {text}
          </Link>
        ))}
      </div>
      {(jobs ?? []).length === 0 ? (
        <Empty>No jobs here yet.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {jobs!.map((j) => {
            const active = j.candidate_jobs.filter((cj) => ACTIVE.includes(cj.stage)).length;
            const ready = j.candidate_jobs.filter((cj) => cj.stage === "ready_to_submit").length;
            const placed = j.candidate_jobs.filter((cj) => cj.stage === "placed").length;
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="panel block p-4 transition hover:border-line-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{j.title}</p>
                    <p className="truncate text-sm text-muted">{[j.companies?.name, j.location].filter(Boolean).join(" · ")}</p>
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
      )}
    </>
  );
}
