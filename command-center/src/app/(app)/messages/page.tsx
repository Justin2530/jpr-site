import { repairEmailBodies } from "@/lib/email-repair";
import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { RULES_SINCE } from "@/lib/conversations";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { ChatIcon, MailIcon } from "@/components/icons";
import { PushToggle } from "@/components/push-toggle";
import { markConversation, markRead } from "./actions";
import {
  baseKey,
  convOf,
  subjectOf,
  currentSince,
  lastRead,
  people,
  soleJobs,
  whoKey,
  whoPath,
  type Person,
  type Who,
} from "@/lib/messages";
import { STAGE_LABEL, timeAgo } from "@/lib/format";

export const metadata = { title: "Messages · JPR" };

type Row = {
  id: string;
  kind: string;
  direction: string | null;
  summary: string;
  body: string | null;
  occurred_at: string;
  candidate_id: string | null;
  contact_id: string | null;
  candidate_job_id: string | null;
  external_thread_id: string | null;
  brain_status: string | null;
  relay_status: string | null;
};

function preview(r: Row) {
  const text =
    (r.kind === "email"
      ? r.summary.replace(/^Email (to|from) [^:]+:\s*/, "")
      : r.body || r.summary) ?? "";
  return text.replace(/\s+/g, " ").trim();
}

// Every text and email with candidates and client contacts, newest conversation first, like a phone's Messages app.
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const { supabase, userId } = await requireStaff();
  const [
    { data: rows },
    { data: reads },
    sole,
    { data: open },
    { data: states },
  ] = await Promise.all([
    supabase
      .from("activities")
      .select(
        "id, kind, direction, summary, body, occurred_at, candidate_id, contact_id, candidate_job_id, external_thread_id, brain_status, relay_status",
      )
      .in("kind", ["text", "email"])
      .or("candidate_id.not.is.null,contact_id.not.is.null")
      .order("occurred_at", { ascending: false })
      .limit(1000),
    supabase
      .from("message_reads")
      .select("who, read_at")
      .eq("staff_id", userId),
    soleJobs(supabase),
    // Messages the triage kept on What needs me as needing Justin (thank-yous, FYIs and the like are cleared).
    supabase
      .from("action_items")
      .select("candidate_id, contact_id, candidate_job_id, created_at")
      .eq("status", "open")
      .in("kind", ["reply", "inbox"]),
    // The AI's read of where each conversation stands (lib/conversations.ts).
    supabase
      .from("conversation_states")
      .select("who, state, reason, last_activity_id, judged_at"),
  ]);
  await repairEmailBodies(supabase, rows ?? []);
  const stateOf = new Map((states ?? []).map((s) => [s.who, s]));
  const readAt = new Map((reads ?? []).map((r) => [r.who, r.read_at]));

  // One row per conversation (each email thread, each job's texts; see convOf): its latest message, and how many
  // came in since Justin last opened it.
  const threads = new Map<
    string,
    {
      who: Who;
      last: Row;
      unread: number;
      subject: string | null;
      candidateId: string | null;
      jobId: string | null;
    }
  >();
  for (const r of (rows ?? []) as Row[]) {
    const who = convOf(r, sole);
    const key = whoKey(who);
    const t = threads.get(key) ?? {
      who,
      last: r,
      unread: 0,
      subject: null,
      candidateId: null,
      jobId: null,
    };
    if (!t.subject && r.kind === "email") t.subject = subjectOf(r);
    if (!t.candidateId && who.kind === "p" && r.candidate_id)
      t.candidateId = r.candidate_id;
    if (!t.jobId && r.candidate_job_id) t.jobId = r.candidate_job_id;
    const seen = lastRead(readAt, who);
    if (r.direction === "in" && (!seen || r.occurred_at > seen)) t.unread++;
    threads.set(key, t);
  }
  const all = [...threads.values()];
  // Who each conversation is with, plus the candidate each client topic is about.
  const who = await people(supabase, [
    ...all.map((t) => t.who),
    ...all.flatMap((t) =>
      t.candidateId ? [{ kind: "c" as const, id: t.candidateId }] : [],
    ),
  ]);

  // Three tabs (Justin 2026-10-11): Waiting on you (they wrote last), Current (anything in the last two weeks, or
  // unread) and History (everything, so nothing is lost). A job conversation whose job is closed for them
  // (passed, withdrawn) only stays current while it has something unread.
  const CURRENT_DAYS = 14;
  const since = currentSince(CURRENT_DAYS);
  const closedJob = (t: (typeof all)[number]) =>
    Boolean(
      t.who.t?.startsWith("j") &&
      !who.get(baseKey(t.who))?.jobs.some((j) => j.cjId === t.who.t!.slice(1)),
    );
  // The AI's verdict counts once it has read the conversation's newest message; until then, the rules below.
  const verdict = (t: (typeof all)[number]) => {
    const v = stateOf.get(whoKey(t.who));
    return v && v.last_activity_id === t.last.id && v.judged_at >= RULES_SINCE
      ? v
      : null;
  };
  const isCurrent = (t: (typeof all)[number]) => {
    if (t.unread > 0) return true;
    const v = verdict(t);
    if (v) return v.state !== "done" && t.last.occurred_at >= currentSince(30);
    return t.last.occurred_at >= since && !closedJob(t);
  };
  // Waiting on you: they wrote last, nobody answered it for him (the reply brain or the client relay), and it's
  // still an open item on What needs me, i.e. the triage judged it needs him.
  const isWaiting = (t: (typeof all)[number]) => {
    const v = verdict(t);
    const r = t.last;
    // Still open on What needs me for this exact conversation (they wrote last about this candidate): it waits on
    // him whatever the AI thought, so Messages and What needs me never disagree.
    if (
      r.direction === "in" &&
      r.contact_id &&
      r.candidate_job_id &&
      (open ?? []).some(
        (i) =>
          i.contact_id === r.contact_id &&
          i.candidate_job_id === r.candidate_job_id &&
          Date.parse(i.created_at) >= Date.parse(r.occurred_at) - 6e4,
      )
    )
      return true;
    if (v) return v.state === "waiting";
    if (
      r.direction !== "in" ||
      r.brain_status === "done" ||
      r.relay_status === "done"
    )
      return false;
    const at = Date.parse(r.occurred_at);
    return (open ?? []).some(
      (i) =>
        (r.contact_id
          ? i.contact_id === r.contact_id
          : i.candidate_id === r.candidate_id) &&
        Date.parse(i.created_at) >= at - 6e4 &&
        Date.parse(i.created_at) <= at + 3 * 36e5,
    );
  };
  const tab = show === "history" || show === "waiting" ? show : "current";
  const counts = {
    waiting: all.filter(isWaiting).length,
    current: all.filter(isCurrent).length,
    history: all.length,
  };
  const list =
    tab === "history"
      ? all
      : all.filter(tab === "waiting" ? isWaiting : isCurrent);

  // What a conversation is about: the email's subject, or the job (or candidate) its texts are about.
  function topic(
    t: (typeof list)[number],
    p: Person,
    about: Person | null | undefined,
  ) {
    const jobOf = (person: Person | null | undefined, cjId: string | null) => {
      const j =
        person?.jobs.find((x) => x.cjId === cjId) ??
        (cjId ? null : person?.jobs[0]);
      return j
        ? `${j.title}${j.company ? ` · ${j.company}` : ""} (${STAGE_LABEL[j.stage]})`
        : null;
    };
    const tk = t.who.t ?? "s";
    if (tk.startsWith("g")) {
      const job =
        t.who.kind === "c"
          ? jobOf(p, t.jobId)
          : about
            ? `${about.name}${jobOf(about, null) ? `, ${jobOf(about, null)}` : ""}`
            : null;
      return `✉ ${t.subject ?? "Email"}${job ? ` · about ${job}` : ""}`;
    }
    if (tk.startsWith("j"))
      return `Texts about ${jobOf(p, tk.slice(1)) ?? "an earlier job"}`;
    if (tk.startsWith("c"))
      return `Texts about ${about?.name ?? "a candidate"}`;
    return "Texts and calls";
  }

  function row(t: (typeof list)[number]) {
    const p = who.get(baseKey(t.who));
    const about = t.candidateId ? who.get(`c:${t.candidateId}`) : null;
    if (!p) return null;
    const Icon = t.last.kind === "text" ? ChatIcon : MailIcon;
    return (
      <li key={whoKey(t.who)} className="flex items-center">
        <Link
          href={whoPath(t.who)}
          className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 hover:bg-white/[0.03]"
        >
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.unread ? "bg-cyan shadow-[0_0_8px_rgb(var(--glow)/0.9)]" : "bg-transparent"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`truncate ${t.unread ? "font-semibold text-ink" : "font-medium"}`}
              >
                {p.name}
              </span>
              <Chip tone={p.role.tone}>{p.role.text}</Chip>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">
                {timeAgo(t.last.occurred_at)}
              </span>
            </div>
            <p className="truncate text-xs font-medium text-ink/80">
              {topic(t, p, about)}
            </p>
            {verdict(t)?.state === "waiting" && verdict(t)?.reason && (
              <p className="truncate text-xs text-amber">
                {verdict(t)!.reason}
              </p>
            )}
            <p className="truncate text-xs text-muted">
              {p.jobs.length
                ? p.jobs
                    .map(
                      (j) =>
                        `${j.title}${j.company ? ` · ${j.company}` : ""} (${STAGE_LABEL[j.stage]})`,
                    )
                    .join(", ")
                : (p.detail ?? (p.who.kind === "c" ? "Not on a job" : ""))}
            </p>
            <p
              className={`mt-0.5 flex items-center gap-1.5 truncate text-sm ${t.unread ? "text-ink" : "text-muted"}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-faint" />
              <span className="truncate">
                {t.last.direction === "out" ? "You: " : ""}
                {preview(t.last)}
              </span>
            </p>
          </div>
          {t.unread > 0 && (
            <span className="mt-0.5 shrink-0 rounded-full bg-cyan px-1.5 font-mono text-[10.5px] text-void">
              {t.unread}
            </span>
          )}
        </Link>
        <div className="flex shrink-0 flex-col gap-1 pr-3 sm:flex-row">
          {t.unread > 0 && (
            <form action={markRead}>
              <input type="hidden" name="who" value={whoKey(t.who)} />
              <button className="btn-quiet py-1 text-xs">Mark read</button>
            </form>
          )}
          {(() => {
            const open =
              tab === "history" ? verdict(t)?.state === "done" : true;
            if (!open) return null;
            const done = tab !== "history";
            return (
              <form action={markConversation}>
                <input type="hidden" name="who" value={whoKey(t.who)} />
                <input type="hidden" name="last" value={t.last.id} />
                <input
                  type="hidden"
                  name="state"
                  value={done ? "done" : "current"}
                />
                <button
                  className="btn-quiet py-1 text-xs"
                  title={
                    done
                      ? "Move it to History until they write again"
                      : "Put it back in Current"
                  }
                >
                  {done ? "Done" : "Reopen"}
                </button>
              </form>
            );
          })()}
        </div>
      </li>
    );
  }

  return (
    <>
      <PageHeader
        title="Messages"
        sub="Texts and emails with candidates and clients. Tap one to read it and reply."
      />
      <div className="space-y-4">
        <PushToggle />
        <div className="flex gap-1.5">
          {(
            [
              ["waiting", "Waiting on you"],
              ["current", "Current"],
              ["history", "History"],
            ] as const
          ).map(([key, text]) => (
            <Link
              key={key}
              href={key === "current" ? "/messages" : `/messages?show=${key}`}
              className={`rounded-md border px-2.5 py-1 text-xs ${tab === key ? "border-cyan/50 bg-cyan-soft text-cyan" : "border-line text-muted hover:text-ink"}`}
            >
              {text} <span className="font-mono text-faint">{counts[key]}</span>
            </Link>
          ))}
        </div>
        {list.length === 0 ? (
          <Empty>
            {tab === "waiting"
              ? "Nobody is waiting on you."
              : tab === "current"
                ? "Nothing going on in the last two weeks. Older conversations are under History."
                : "No texts or emails yet."}
          </Empty>
        ) : (
          [
            // Contacts at a client company are Clients; everyone else Justin talks to on the sales side is a Lead.
            [
              "Clients",
              list.filter(
                (t) =>
                  t.who.kind === "p" &&
                  who.get(baseKey(t.who))?.role.text === "Client",
              ),
            ],
            [
              "Leads",
              list.filter(
                (t) =>
                  t.who.kind === "p" &&
                  who.get(baseKey(t.who))?.role.text !== "Client",
              ),
            ],
            ["Candidates", list.filter((t) => t.who.kind === "c")],
          ].map(([title, items]) =>
            (items as typeof list).length === 0 ? null : (
              <section key={title as string} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {title as string}{" "}
                  <span className="font-mono text-faint">
                    {(items as typeof list).length}
                  </span>
                </h2>
                <ul className="panel divide-y divide-line overflow-hidden">
                  {(items as typeof list).map(row)}
                </ul>
              </section>
            ),
          )
        )}
      </div>
    </>
  );
}
