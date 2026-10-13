import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip } from "@/components/ui";
import {
  DEAL_STAGE_LABEL,
  DEAL_STAGE_TONE,
  STAGE_LABEL,
  STAGE_TONE,
  daysSince,
  interviewWhen,
  timeAgo,
  type Tone,
} from "@/lib/format";
import type { Enums } from "@/lib/database.types";

export const metadata = { title: "Dashboard · JPR" };

// Justin 2026-10-13: a board separate from What needs me, with sections left to right (interviews coming up, past
// interviews, who is in conversation, leads, candidates needing follow-up). Built like the boards in modern CRMs:
// one column per kind of work, in the order a candidate moves, each card one person with the one fact that matters
// and a click straight to their job tab. What needs me stays the place for his approvals.

const QUIET_DAYS = 3;

type CJ = {
  id: string;
  stage: Enums<"pipeline_stage">;
  candidate_id: string;
  candidates: { full_name: string } | null;
  jobs: { title: string; companies: { name: string } | null } | null;
};
const CJ_SELECT =
  "id, stage, candidate_id, candidates(full_name), jobs(title, companies(name))";

type Card = {
  key: string;
  href: string;
  name: string;
  sub: string;
  when?: string;
  chip?: { text: string; tone: Tone };
  note?: string | null;
};

function cardFor(cj: CJ | null, rest: Omit<Card, "href" | "name" | "sub">): Card | null {
  if (!cj) return null;
  const job = cj.jobs;
  return {
    href: `/candidates/${cj.candidate_id}?job=${cj.id}`,
    name: cj.candidates?.full_name ?? "Unknown",
    sub: [job?.title, job?.companies?.name].filter(Boolean).join(" · "),
    ...rest,
  };
}

const COLUMNS = [
  { key: "upcoming", title: "Interviews coming up", bar: "bg-amber", text: "text-amber", empty: "No client interviews booked." },
  { key: "past", title: "Recent interviews", bar: "bg-rose", text: "text-rose", empty: "No interviews in the last 2 weeks." },
  { key: "screening", title: "Screening calls", bar: "bg-cyan", text: "text-cyan", empty: "No screening calls booked." },
  { key: "conversation", title: "In conversation", bar: "bg-cyan", text: "text-cyan", empty: "Nobody in conversation right now." },
  { key: "followup", title: "Needs follow-up", bar: "bg-rose", text: "text-rose", empty: `Everyone has been touched in the last ${QUIET_DAYS} days.` },
  { key: "submitted", title: "Submitted, waiting on client", bar: "bg-amber", text: "text-amber", empty: "No submissions waiting on a client." },
  { key: "offers", title: "Offers", bar: "bg-mint", text: "text-mint", empty: "No offers in progress." },
  { key: "leads", title: "Current leads", bar: "bg-ink/60", text: "text-ink", empty: "No open leads." },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];

export default async function Dashboard() {
  const { supabase } = await requireStaff();
  const now = new Date();
  const nowIso = now.toISOString();
  const pastFrom = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const screeningFrom = new Date(now.getTime() - 2 * 3600_000).toISOString();

  const [interviews, screenings, active, submissions, offers, deals, pursuits] = await Promise.all([
    supabase
      .from("interviews")
      .select(`id, status, waiting_on, scheduled_at, details, candidate_jobs(${CJ_SELECT})`)
      .in("status", ["proposing", "confirmed", "done"])
      .or(`scheduled_at.is.null,scheduled_at.gte.${pastFrom}`)
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from("screening_runs")
      .select(`id, scheduled_for, candidate_jobs(${CJ_SELECT})`)
      .eq("status", "scheduled")
      .gte("scheduled_for", screeningFrom)
      .order("scheduled_for")
      .limit(50),
    supabase
      .from("candidate_jobs")
      .select(`${CJ_SELECT}, stage_changed_at`)
      .in("stage", ["assigned", "contacting", "conversation", "ready_to_submit"])
      .order("stage_changed_at", { ascending: false })
      .limit(300),
    supabase
      .from("submissions")
      .select(`id, sent_at, client_followup_at, candidate_jobs(${CJ_SELECT})`)
      .eq("status", "sent")
      .is("client_replied_at", null)
      .order("sent_at", { ascending: true })
      .limit(50),
    supabase
      .from("offers")
      .select(`id, status, waiting_on, pay, start_date, updated_at, candidate_jobs(${CJ_SELECT})`)
      .in("status", ["review", "confirm_asked", "ready", "sent", "countered"])
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("deals")
      .select("id, title, stage, next_step, next_step_on, updated_at, companies(name)")
      .in("stage", ["lead", "contacted", "meeting", "proposal"])
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase.from("pursuits").select("candidate_job_id").eq("status", "active").is("paused_at", null),
  ]);

  // Last text, email or call with each active candidate on each job, to tell who has gone quiet.
  const activeRows = (active.data ?? []) as unknown as (CJ & { stage_changed_at: string })[];
  const { data: touches } = activeRows.length
    ? await supabase
        .from("activities")
        .select("candidate_job_id, occurred_at, direction")
        .in("candidate_job_id", activeRows.map((r) => r.id))
        .in("kind", ["text", "email", "call"])
        .order("occurred_at", { ascending: false })
        .limit(3000)
    : { data: [] };
  const lastTouch = new Map<string, { at: string; direction: string | null }>();
  for (const t of touches ?? [])
    if (t.candidate_job_id && !lastTouch.has(t.candidate_job_id))
      lastTouch.set(t.candidate_job_id, { at: t.occurred_at, direction: t.direction });
  const automated = new Set((pursuits.data ?? []).map((p) => p.candidate_job_id));

  const cols: Record<ColKey, Card[]> = {
    upcoming: [],
    screening: [],
    past: [],
    conversation: [],
    followup: [],
    submitted: [],
    offers: [],
    leads: [],
  };
  const push = (k: ColKey, c: Card | null) => c && cols[k].push(c);

  for (const i of interviews.data ?? []) {
    const cj = i.candidate_jobs as unknown as CJ | null;
    const at = i.scheduled_at;
    if (i.status === "proposing")
      push(
        "upcoming",
        cardFor(cj, {
          key: `i${i.id}`,
          when: "Being scheduled",
          chip: { text: i.waiting_on === "client" ? "Waiting on client" : "Waiting on candidate", tone: "muted" },
        }),
      );
    else if (at && at >= nowIso && i.status === "confirmed")
      push("upcoming", cardFor(cj, { key: `i${i.id}`, when: interviewWhen(at), note: i.details }));
    else if (at && at < nowIso)
      push(
        "past",
        cardFor(cj, {
          key: `i${i.id}`,
          when: interviewWhen(at),
          chip: cj ? { text: STAGE_LABEL[cj.stage], tone: STAGE_TONE[cj.stage] } : undefined,
        }),
      );
  }
  cols.past.reverse();

  for (const s of screenings.data ?? [])
    push(
      "screening",
      cardFor(s.candidate_jobs as unknown as CJ | null, { key: `s${s.id}`, when: interviewWhen(s.scheduled_for!) }),
    );

  for (const cj of activeRows) {
    const last = lastTouch.get(cj.id);
    const lastAt = last?.at ?? cj.stage_changed_at;
    if (cj.stage === "conversation")
      push(
        "conversation",
        cardFor(cj, {
          key: `c${cj.id}`,
          when: last ? `${last.direction === "in" ? "They wrote" : "We wrote"} ${timeAgo(last.at)}` : undefined,
        }),
      );
    // Gone quiet: nothing sent or received on this job in a few days, and the automation isn't working them.
    if (!automated.has(cj.id) && daysSince(lastAt) >= QUIET_DAYS)
      push(
        "followup",
        cardFor(cj, {
          key: `f${cj.id}`,
          when: last ? `Last contact ${timeAgo(last.at)}` : `No contact yet · assigned ${timeAgo(cj.stage_changed_at)}`,
          chip: { text: STAGE_LABEL[cj.stage], tone: STAGE_TONE[cj.stage] },
        }),
      );
  }
  cols.conversation.sort((a, b) => (a.when ?? "").localeCompare(b.when ?? ""));

  for (const s of submissions.data ?? []) {
    const cj = s.candidate_jobs as unknown as CJ | null;
    // Once they're interviewing or further along, the client has answered in practice.
    if (cj?.stage !== "submitted") continue;
    push(
      "submitted",
      cardFor(cj, {
        key: `u${s.id}`,
        when: `Sent ${timeAgo(s.sent_at)}`,
        chip: daysSince(s.sent_at) >= 3 ? { text: "Follow up", tone: "rose" } : undefined,
      }),
    );
  }

  const OFFER_LABEL: Record<string, string> = {
    review: "Needs your review",
    confirm_asked: "Confirming terms",
    ready: "Ready to send",
    sent: "Sent",
    countered: "Countered",
  };
  for (const o of offers.data ?? [])
    push(
      "offers",
      cardFor(o.candidate_jobs as unknown as CJ | null, {
        key: `o${o.id}`,
        when: [o.pay, o.start_date && `Start ${o.start_date}`].filter(Boolean).join(" · ") || undefined,
        chip: { text: OFFER_LABEL[o.status] ?? o.status, tone: o.waiting_on === "justin" ? "amber" : "mint" },
      }),
    );

  for (const d of deals.data ?? []) {
    const company = (d.companies as unknown as { name: string } | null)?.name;
    cols.leads.push({
      key: `d${d.id}`,
      href: `/deals/${d.id}`,
      name: company ?? d.title,
      sub: company ? d.title : "",
      when: d.next_step
        ? `${d.next_step}${d.next_step_on ? ` · ${d.next_step_on}` : ""}`
        : `Updated ${timeAgo(d.updated_at)}`,
      chip: { text: DEAL_STAGE_LABEL[d.stage], tone: DEAL_STAGE_TONE[d.stage] },
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="panel-title mb-1.5 text-cyan/80">Dashboard</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Where everything stands</h1>
        </div>
        <nav className="flex flex-wrap gap-1.5" aria-label="Jump to a column">
          {COLUMNS.map((c) => (
            <a key={c.key} href={`#col-${c.key}`} className="chip border-line text-muted hover:text-cyan">
              {c.title} <span className={`readout ${c.text}`}>{cols[c.key].length}</span>
            </a>
          ))}
        </nav>
      </header>

      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        {COLUMNS.map((col) => {
          const list = cols[col.key];
          return (
            <section
              key={col.key}
              id={`col-${col.key}`}
              className="panel flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col overflow-hidden sm:w-[280px]"
            >
              <div className={`h-1 ${col.bar}`} />
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                <h2 className="text-sm font-semibold">{col.title}</h2>
                <span className={`readout text-base ${col.text}`}>{list.length}</span>
              </div>
              <div className="max-h-[calc(100vh-15rem)] flex-1 space-y-2 overflow-y-auto p-2.5">
                {list.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-faint">{col.empty}</p>
                ) : (
                  list.map((c) => (
                    <Link
                      key={c.key}
                      href={c.href}
                      className="block rounded-lg border border-line bg-white/[0.02] px-3 py-2.5 transition hover:border-line-strong hover:bg-white/[0.05]"
                    >
                      <p className="truncate font-medium">{c.name}</p>
                      {c.sub && <p className="truncate text-xs text-muted">{c.sub}</p>}
                      {(c.when || c.chip) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {c.when && <span className={`font-mono text-[11px] ${col.text}`}>{c.when}</span>}
                          {c.chip && <Chip tone={c.chip.tone}>{c.chip.text}</Chip>}
                        </div>
                      )}
                      {c.note && <p className="mt-1 line-clamp-2 text-xs text-muted">{c.note}</p>}
                    </Link>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
