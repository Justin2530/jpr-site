import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Dot, Empty, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ChevronIcon, ShieldIcon } from "@/components/icons";
import { timeAgo, type Tone } from "@/lib/format";
import type { Tables } from "@/lib/database.types";
import { addTask, clearSampleData, resolveTask } from "./actions";
import { InboxDraft } from "@/components/inbox-draft";

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
  reminder: { label: "Reminder", tone: "cyan" },
  reply: { label: "Reply", tone: "amber" },
  website_lead: { label: "Website", tone: "cyan" },
  offer: { label: "Offer", tone: "amber" },
  inbox: { label: "Inbox", tone: "cyan" },
};

function hrefFor(item: Tables<"needs_me">) {
  if (item.key?.startsWith("deal:")) return `/deals/${item.key.slice(5)}`;
  if (item.key?.startsWith("invoice:"))
    return `/placements/${item.key.slice(8)}`;
  if (item.candidate_id && item.candidate_job_id)
    return `/candidates/${item.candidate_id}?job=${item.candidate_job_id}`;
  if (item.candidate_id) return `/candidates/${item.candidate_id}`;
  if (item.job_id) return `/jobs/${item.job_id}`;
  if (item.company_id) return `/companies/${item.company_id}`;
  if (item.kind === "service_renewal") return "/tools";
  return null;
}

// What needs me as side-by-side category cards, newest first in each, so something from ten minutes ago is at
// the top of its card instead of under two weeks of older things (Justin 2026-10-29: "it can't just be one
// long scrolling stuff ... I need side by side categories where I can instantly look at stuff"). Each row is
// one line; its details open on a click. Class strings stay whole so Tailwind keeps them.
const SECTIONS = [
  { key: "leads", title: "Leads", look: "border-t-cyan/70", text: "text-cyan" },
  {
    key: "call",
    title: "Calls to make or return",
    look: "border-t-rose/70",
    text: "text-rose",
  },
  {
    key: "message",
    title: "Messages waiting on you",
    look: "border-t-cyan/70",
    text: "text-cyan",
  },
  {
    key: "submit",
    title: "Submissions and offers",
    look: "border-t-amber/70",
    text: "text-amber",
  },
  {
    key: "people",
    title: "New people to review",
    look: "border-t-mint/70",
    text: "text-mint",
  },
  {
    key: "sales",
    title: "Sales and business",
    look: "border-t-ink/50",
    text: "text-ink",
  },
  {
    key: "tasks",
    title: "Tasks and reminders",
    look: "border-t-muted/60",
    text: "text-muted",
  },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

function sectionFor(item: Tables<"needs_me">): SectionKey {
  const kind = item.kind ?? "task";
  const title = item.title ?? "";
  if (["submission_ready", "offer", "protected_client"].includes(kind))
    return "submit";
  if (
    /^(call back|call |return call|missed call|voicemail|screening call)/i.test(
      title,
    )
  )
    return "call";
  if (kind === "website_lead") return "leads";
  if (
    kind === "needs_contact" ||
    (kind === "inbox" && /^new candidate/i.test(title))
  )
    return "people";
  if (kind === "reply" || kind === "inbox") return "message";
  if (
    [
      "deal_follow_up",
      "agreement_ending",
      "service_renewal",
      "invoice_due",
      "stale_job",
    ].includes(kind)
  )
    return "sales";
  return "tasks";
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/New_York",
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function Home() {
  const { supabase, staff } = await requireStaff();
  const now = new Date().getTime();
  const soon = new Date(now - 2 * 3600_000).toISOString();

  const [needs, recent, samples, upcoming, drafts] = await Promise.all([
    supabase
      .from("needs_me")
      .select("*")
      .order("since", { ascending: false })
      .limit(300),
    supabase
      .from("activities")
      .select(
        "id, summary, occurred_at, kind, candidate_id, job_id, company_id, candidates(full_name)",
      )
      .order("occurred_at", { ascending: false })
      .limit(12),
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("is_sample", true),
    supabase
      .from("screening_runs")
      .select(
        "id, scheduled_for, candidate_job_id, candidate_jobs(candidate_id, candidates(full_name), jobs(title))",
      )
      .eq("status", "scheduled")
      .gte("scheduled_for", soon)
      .order("scheduled_for")
      .limit(8),
    supabase
      .from("inbox_drafts")
      .select("id, action_item_id, body")
      .eq("status", "awaiting"),
  ]);
  const draftFor = new Map(
    (drafts.data ?? []).map((d) => [d.action_item_id, d]),
  );

  const items = needs.data ?? [];
  const first = (staff.full_name ?? staff.email).split(/[\s@]/)[0];
  const name = first.charAt(0).toUpperCase() + first.slice(1);

  return (
    <div className="space-y-6">
      {(samples.count ?? 0) > 0 && staff.role === "owner" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm">
          <span>
            <span className="font-medium text-amber">Sample data loaded.</span>{" "}
            <span className="text-ink/90">
              Companies starting with &quot;Sample:&quot; and their people, jobs
              and deals are placeholders.
            </span>
          </span>
          <form action={clearSampleData}>
            <SubmitButton
              className="btn-quiet border-amber/40 text-amber"
              pendingText="Clearing…"
            >
              Clear sample data
            </SubmitButton>
          </form>
        </div>
      )}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="panel-title mb-1.5 text-cyan/80">
            <span className="jarvis-only">Systems online</span>
            <span className="matrix-only">Wake up, {name}…</span>
          </p>
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

      {items.length === 0 ? (
        <Panel title="What needs me">
          <Empty>
            All clear. Assign a candidate to a job and it will show up here.
          </Empty>
        </Panel>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {SECTIONS.map((sec) => {
            const list = items.filter((item) => sectionFor(item) === sec.key);
            const today = list.filter(
              (item) =>
                item.since && now - new Date(item.since).getTime() < 86400_000,
            ).length;
            return (
              <section
                key={sec.key}
                className={`panel overflow-hidden border-t-4 ${sec.look}`}
              >
                <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5">
                  <h2 className="font-semibold">{sec.title}</h2>
                  <span className="flex items-center gap-2">
                    {today > 0 && <Chip tone="cyan">{today} new</Chip>}
                    <span className={`readout text-lg ${sec.text}`}>
                      {list.length}
                    </span>
                  </span>
                </div>
                {list.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-faint">Nothing here.</p>
                ) : (
                  <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                    {list.map((item) => {
                      const k = KIND[item.kind ?? "task"] ?? KIND.task;
                      const href = hrefFor(item);
                      const taskId = item.key?.startsWith("task:")
                        ? item.key.slice(5)
                        : null;
                      const fresh =
                        !!item.since &&
                        now - new Date(item.since).getTime() < 86400_000;
                      const draft = taskId ? draftFor.get(taskId) : undefined;
                      const more = !!item.detail || !!draft;
                      return (
                        <li key={item.key} className="px-3 py-2">
                          <details className="group/item">
                            <summary
                              className={`flex list-none items-start gap-2 [&::-webkit-details-marker]:hidden ${more ? "cursor-pointer" : ""}`}
                            >
                              <span className="pt-1.5">
                                {item.kind === "protected_client" ? (
                                  <ShieldIcon className="h-3.5 w-3.5 text-rose" />
                                ) : (
                                  <Dot
                                    tone={
                                      item.priority === 1 ? "amber" : k.tone
                                    }
                                  />
                                )}
                              </span>
                              <span className="min-w-0 flex-1 text-sm">
                                {href ? (
                                  <Link
                                    href={href}
                                    className="link font-medium"
                                  >
                                    {item.title}
                                  </Link>
                                ) : (
                                  <span className="font-medium">
                                    {item.title}
                                  </span>
                                )}
                                {more && (
                                  <ChevronIcon className="ml-1 inline h-3 w-3 -rotate-90 text-faint transition group-open/item:rotate-0" />
                                )}
                              </span>
                              <span
                                className={`shrink-0 font-mono text-[11px] ${fresh ? "text-cyan" : "text-faint"}`}
                              >
                                {timeAgo(item.since)}
                              </span>
                            </summary>
                            {more && (
                              <div className="mt-1.5 pl-5">
                                {item.detail && (
                                  <p className="whitespace-pre-line text-sm text-muted">
                                    {item.detail}
                                  </p>
                                )}
                                {draft && (
                                  <InboxDraft id={draft.id} body={draft.body} />
                                )}
                              </div>
                            )}
                          </details>
                          {taskId && (
                            <form action={resolveTask} className="mt-1 pl-5">
                              <input type="hidden" name="id" value={taskId} />
                              <SubmitButton
                                className="btn-quiet px-2 py-0.5 text-[11px]"
                                pendingText="…"
                              >
                                Done
                              </SubmitButton>
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {sec.key === "leads" && (
                  <Link
                    href="/inbound"
                    className="block border-t border-line px-3 py-2 text-xs text-cyan hover:underline"
                  >
                    All leads →
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      )}

      <form action={addTask} className="flex gap-2">
        <input
          name="title"
          className="field"
          placeholder="Add a reminder for yourself…"
          aria-label="New reminder"
        />
        <input
          name="due_on"
          type="date"
          className="field w-40"
          aria-label="Due date"
        />
        <SubmitButton className="btn shrink-0">Add</SubmitButton>
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Coming up">
          {(upcoming.data ?? []).length === 0 ? (
            <Empty>No screening calls booked.</Empty>
          ) : (
            <ul className="space-y-3">
              {(upcoming.data ?? []).map((r) => (
                <li key={r.id} className="text-sm">
                  <p className="font-mono text-[11px] text-cyan">
                    {new Date(r.scheduled_for!).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                  <p>
                    <Link
                      href={`/candidates/${r.candidate_jobs?.candidate_id}?job=${r.candidate_job_id}`}
                      className="link font-medium"
                    >
                      {r.candidate_jobs?.candidates?.full_name}
                    </Link>{" "}
                    <span className="text-muted">
                      · Screening call · {r.candidate_jobs?.jobs?.title}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
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
                      <Link
                        href={`/candidates/${a.candidate_id}`}
                        className="link font-medium"
                      >
                        {a.candidates.full_name}
                      </Link>
                    )}{" "}
                    <span className="text-muted">{a.summary}</span>
                  </p>
                  <p className="font-mono text-[10.5px] text-faint">
                    {timeAgo(a.occurred_at)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
