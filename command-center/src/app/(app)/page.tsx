import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Dot, Empty, Panel, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ShieldIcon } from "@/components/icons";
import { timeAgo, type Tone } from "@/lib/format";
import type { Tables } from "@/lib/database.types";
import { addTask, clearSampleData, resolveTask } from "./actions";

const KIND: Record<string, { label: string; tone: Tone }> = {
  protected_client: { label: "Client protection", tone: "rose" },
  needs_contact: { label: "Reach out", tone: "cyan" },
  submission_ready: { label: "Submission", tone: "amber" },
  stale_job: { label: "Stalled job", tone: "amber" },
  agreement_ending: { label: "Renewal", tone: "amber" },
  service_renewal: { label: "Subscription", tone: "amber" },
  deal_follow_up: { label: "Sales", tone: "cyan" },
  invoice_due: { label: "Invoice", tone: "amber" },
  task: { label: "Task", tone: "muted" },
};

function hrefFor(item: Tables<"needs_me">) {
  if (item.key?.startsWith("deal:")) return `/deals/${item.key.slice(5)}`;
  if (item.key?.startsWith("invoice:")) return `/placements/${item.key.slice(8)}`;
  if (item.candidate_id) return `/candidates/${item.candidate_id}`;
  if (item.job_id) return `/jobs/${item.job_id}`;
  if (item.company_id) return `/companies/${item.company_id}`;
  if (item.kind === "service_renewal") return "/tools";
  return null;
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const CLOSED_STAGES = "(placed,passed,withdrawn)";

export default async function Home() {
  const { supabase, staff } = await requireStaff();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [needs, openJobs, inPipeline, readyToSubmit, placedMonth, openDeals, recent, samples] = await Promise.all([
    supabase.from("needs_me").select("*").order("priority").order("since", { ascending: true }).limit(50),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("candidate_jobs").select("id", { count: "exact", head: true }).not("stage", "in", CLOSED_STAGES),
    supabase.from("candidate_jobs").select("id", { count: "exact", head: true }).eq("stage", "ready_to_submit"),
    supabase.from("candidate_jobs").select("id", { count: "exact", head: true }).eq("stage", "placed").gte("stage_changed_at", monthStart),
    supabase.from("deals").select("id", { count: "exact", head: true }).not("stage", "in", "(won,lost)"),
    supabase
      .from("activities")
      .select("id, summary, occurred_at, kind, candidate_id, job_id, company_id, candidates(full_name)")
      .order("occurred_at", { ascending: false })
      .limit(12),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("is_sample", true),
  ]);

  const items = needs.data ?? [];
  const first = (staff.full_name ?? staff.email).split(/[\s@]/)[0];
  const name = first.charAt(0).toUpperCase() + first.slice(1);

  return (
    <div className="space-y-6">
      {(samples.count ?? 0) > 0 && staff.role === "owner" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm">
          <span>
            <span className="font-medium text-amber">Sample data loaded.</span>{" "}
            <span className="text-ink/90">Companies starting with &quot;Sample:&quot; and their people, jobs and deals are placeholders.</span>
          </span>
          <form action={clearSampleData}>
            <SubmitButton className="btn-quiet border-amber/40 text-amber" pendingText="Clearing…">
              Clear sample data
            </SubmitButton>
          </form>
        </div>
      )}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="panel-title mb-1.5 text-cyan/80">Systems online</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting()}, {name}.
          </h1>
          <p className="mt-1 text-sm text-muted">
            {items.length === 0
              ? "Nothing needs you right now."
              : `${items.length} ${items.length === 1 ? "thing needs" : "things need"} you.`}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Open jobs" value={openJobs.count ?? 0} href="/jobs" />
        <Stat label="In pipeline" value={inPipeline.count ?? 0} href="/pipeline" />
        <Stat label="Ready to submit" value={readyToSubmit.count ?? 0} tone="amber" href="/pipeline" />
        <Stat label="Placed this month" value={placedMonth.count ?? 0} tone="mint" href="/placements?period=month" />
        <Stat label="Open deals" value={openDeals.count ?? 0} href="/deals" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel title="What needs me" action={<span className="readout text-xs text-cyan">{items.length}</span>}>
          {items.length === 0 ? (
            <Empty>All clear. Assign a candidate to a job and it will show up here.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-line">
              {items.map((item) => {
                const k = KIND[item.kind ?? "task"] ?? KIND.task;
                const href = hrefFor(item);
                const taskId = item.key?.startsWith("task:") ? item.key.slice(5) : null;
                return (
                  <li key={item.key} className="flex items-start gap-3 py-3">
                    <div className="pt-1.5">
                      {item.kind === "protected_client" ? <ShieldIcon className="h-4 w-4 text-rose" /> : <Dot tone={item.priority === 1 ? "amber" : k.tone} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {href ? (
                          <Link href={href} className="link font-medium">
                            {item.title}
                          </Link>
                        ) : (
                          <span className="font-medium">{item.title}</span>
                        )}
                        <Chip tone={k.tone}>{k.label}</Chip>
                      </div>
                      {item.detail && <p className="mt-0.5 text-sm text-muted">{item.detail}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] text-faint">{timeAgo(item.since)}</span>
                      {taskId && (
                        <form action={resolveTask}>
                          <input type="hidden" name="id" value={taskId} />
                          <SubmitButton className="btn-quiet px-2 py-1 text-xs" pendingText="…">
                            Done
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <form action={addTask} className="mt-4 flex gap-2 border-t border-line pt-4">
            <input name="title" className="field" placeholder="Add a reminder for yourself…" aria-label="New reminder" />
            <input name="due_on" type="date" className="field w-40" aria-label="Due date" />
            <SubmitButton className="btn shrink-0">Add</SubmitButton>
          </form>
        </Panel>

        <Panel title="What's happening">
          {(recent.data ?? []).length === 0 ? (
            <Empty>No activity yet.</Empty>
          ) : (
            <ol className="relative space-y-4 border-l border-line pl-4">
              {(recent.data ?? []).map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-cyan/60 bg-void" />
                  <p className="text-sm">
                    {a.candidates?.full_name && (
                      <Link href={`/candidates/${a.candidate_id}`} className="link font-medium">
                        {a.candidates.full_name}
                      </Link>
                    )}{" "}
                    <span className="text-muted">{a.summary}</span>
                  </p>
                  <p className="font-mono text-[10.5px] text-faint">{timeAgo(a.occurred_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
