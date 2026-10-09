import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty } from "@/components/ui";
import { PhoneIcon } from "@/components/icons";
import { parseWho, people, whoKey } from "@/lib/messages";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/format";
import { ReplyBox } from "./reply-box";

export const metadata = { title: "Conversation · JPR" };

type Row = {
  id: string;
  kind: string;
  direction: string | null;
  summary: string;
  body: string | null;
  occurred_at: string;
  external_status: string | null;
  external_thread_id: string | null;
  duration_seconds: number | null;
};

const PROBLEM = ["failed", "undelivered"];

function stamp(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

// One conversation: who they are and what they're on, every text and email (calls as markers), and a reply box.
export default async function ConversationPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const who = parseWho(key);
  if (!who) notFound();
  const { supabase, userId } = await requireStaff();
  const col = who.kind === "c" ? "candidate_id" : "contact_id";

  const [{ data: rows }, info, { data: cand }, { data: contact }] = await Promise.all([
    supabase
      .from("activities")
      .select("id, kind, direction, summary, body, occurred_at, external_status, external_thread_id, duration_seconds")
      .eq(col, who.id)
      .in("kind", ["text", "email", "call"])
      .order("occurred_at", { ascending: false })
      .limit(200),
    people(supabase, [who]),
    who.kind === "c"
      ? supabase
          .from("candidates")
          .select("phone, email, indeed_relay, indeed_thread_id, indeed_subject, sms_opted_out_at")
          .eq("id", who.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    who.kind === "p"
      ? supabase.from("contacts").select("phone, email, sms_opted_out_at").eq("id", who.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const person = info.get(whoKey(who));
  if (!person) notFound();

  // Opening the conversation marks it read.
  await supabase.from("message_reads").upsert({ staff_id: userId, who: whoKey(who), read_at: new Date().toISOString() });

  const list = ((rows ?? []) as Row[]).reverse();
  const lastEmail = [...list].reverse().find((r) => r.kind === "email");
  const lastIn = [...list].reverse().find((r) => r.direction === "in" && r.kind !== "call");
  const phone = cand?.phone ?? contact?.phone ?? null;
  const viaIndeed = !cand?.email && Boolean(cand?.indeed_relay);
  const email = cand?.email ?? cand?.indeed_relay ?? contact?.email ?? null;
  const profile = who.kind === "c" ? `/candidates/${who.id}` : `/contacts/${who.id}`;
  const optedOut = cand?.sms_opted_out_at ?? contact?.sms_opted_out_at;

  return (
    <div className="space-y-4">
      <div className="panel px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/messages" className="text-sm text-muted hover:text-cyan">
            ‹ Messages
          </Link>
          <Link href={profile} className="ml-auto text-sm text-muted hover:text-cyan">
            Open profile ›
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{person.name}</h1>
          <Chip tone={person.role.tone}>{person.role.text}</Chip>
        </div>
        {person.detail && <p className="text-sm text-muted">{person.detail}</p>}
        {who.kind === "c" &&
          (person.jobs.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {person.jobs.map((j) => (
                <Link
                  key={j.id}
                  href={`/candidates/${who.id}?job=${j.cjId}`}
                  className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1 text-sm hover:border-cyan/40"
                >
                  {j.title}
                  {j.company && <span className="text-muted">· {j.company}</span>}
                  <Chip tone={STAGE_TONE[j.stage]}>{STAGE_LABEL[j.stage]}</Chip>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Not on a job.</p>
          ))}
      </div>

      {list.length === 0 ? (
        <Empty>No texts or emails with {person.name.split(" ")[0]} yet.</Empty>
      ) : (
        <ol className="space-y-3">
          {list.map((r) => {
            if (r.kind === "call")
              return (
                <li key={r.id} className="flex items-center justify-center gap-2 text-xs text-faint">
                  <PhoneIcon className="h-3.5 w-3.5" />
                  {r.summary} · {stamp(r.occurred_at)}
                </li>
              );
            const out = r.direction === "out";
            const subject = r.kind === "email" ? r.summary.replace(/^Email (to|from) [^:]+:\s*/, "") : null;
            const body = (r.body ?? "").trim();
            const long = body.length > 700;
            return (
              <li key={r.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl border px-3.5 py-2.5 sm:max-w-[70%] ${
                    out ? "rounded-br-sm border-cyan/30 bg-cyan-soft" : "rounded-bl-sm border-line bg-white/[0.03]"
                  }`}
                >
                  {subject && <p className="mb-1 text-xs font-medium text-muted">✉ {subject}</p>}
                  {long ? (
                    <details>
                      <summary className="cursor-pointer whitespace-pre-wrap break-words text-sm">{body.slice(0, 500)}… <span className="text-cyan">more</span></summary>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{body.slice(500)}</p>
                    </details>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm">{body || r.summary}</p>
                  )}
                  <p className={`mt-1 font-mono text-[10px] text-faint ${out ? "text-right" : ""}`}>
                    {r.kind === "text" ? "Text" : "Email"} · {stamp(r.occurred_at)}
                    {r.external_status && PROBLEM.includes(r.external_status) && <span className="text-amber"> · not delivered</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <ReplyBox
        links={{ [col]: who.id }}
        path={`/messages/${key}`}
        name={person.name}
        phone={phone}
        email={email}
        thread={viaIndeed ? (cand?.indeed_thread_id ?? lastEmail?.external_thread_id ?? null) : (lastEmail?.external_thread_id ?? null)}
        subject={
          lastEmail
            ? lastEmail.summary.replace(/^Email (to|from) [^:]+:\s*/, "")
            : viaIndeed
              ? (cand?.indeed_subject ?? null)
              : null
        }
        through={viaIndeed ? "Indeed" : null}
        start={lastIn?.kind === "email" ? "email" : "text"}
        textBlocked={optedOut ? `${person.name.split(" ")[0]} replied STOP, so texting is blocked.` : null}
      />
    </div>
  );
}
