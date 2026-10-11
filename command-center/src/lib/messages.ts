import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Tone } from "@/lib/format";

type DB = SupabaseClient<Database>;

// A conversation key: "c-<candidate id>" or "p-<contact id>" in URLs, "c:<id>" / "p:<id>" in message_reads.
// Everyone's messages are split into separate conversations (Justin 2026-10-11: "it should be able to tie txts and
// emails to a specific conversation and those should be separate in messages"), marked by t:
//   g<gmail thread id>  each email thread
//   j<candidate job id> a candidate's texts and calls about one job (untagged ones go to their only open job)
//   c<candidate id>     a client contact's texts and calls about one candidate
//   s                   texts and calls about nothing in particular
// URLs add "~<t>"; message_reads keys add ":<t>".
export type Who = { kind: "c" | "p"; id: string; t?: string };
export const whoKey = (w: Who) => `${w.kind}:${w.id}${w.t ? `:${w.t}` : ""}`;
export const baseKey = (w: Who) => `${w.kind}:${w.id}`;
export const whoPath = (w: Who) =>
  `/messages/${w.kind}-${w.id}${w.t ? `~${w.t}` : ""}`;
export const TOPIC = /^(g[0-9a-z]{1,40}|[jc][0-9a-f-]{36}|s)$/i;
export function parseWho(key: string): Who | null {
  const m = decodeURIComponent(key).match(
    /^([cp])-([0-9a-f-]{36})(?:~(g[0-9a-z]{1,40}|[jc][0-9a-f-]{36}|s))?$/i,
  );
  if (!m) return null;
  return { kind: m[1] as "c" | "p", id: m[2], ...(m[3] ? { t: m[3] } : {}) };
}

// Which conversation a text, email or call belongs to. soleJob: candidate id -> their only open job link, so an
// untagged text still lands in that job's conversation.
export type MsgRow = {
  kind: string;
  candidate_id: string | null;
  contact_id: string | null;
  candidate_job_id: string | null;
  external_thread_id: string | null;
};
export function convOf(r: MsgRow, soleJob: Map<string, string>): Who {
  const thread =
    r.kind === "email" &&
    r.external_thread_id &&
    /^[0-9a-z]{1,40}$/i.test(r.external_thread_id)
      ? `g${r.external_thread_id}`
      : null;
  // Anything with a client contact on it (submission emails, their replies) is that contact's.
  if (r.contact_id)
    return {
      kind: "p",
      id: r.contact_id,
      t: thread ?? (r.candidate_id ? `c${r.candidate_id}` : "s"),
    };
  const job = r.candidate_job_id ?? soleJob.get(r.candidate_id!);
  return {
    kind: "c",
    id: r.candidate_id!,
    t: thread ?? (job ? `j${job}` : "s"),
  };
}

// Each candidate's only open job link, for filing untagged texts.
export async function soleJobs(supabase: DB) {
  const { data } = await supabase
    .from("candidate_jobs")
    .select("id, candidate_id")
    .not("stage", "in", `(${CLOSED_STAGES.join(",")})`);
  const count = new Map<string, number>();
  for (const r of data ?? [])
    count.set(r.candidate_id, (count.get(r.candidate_id) ?? 0) + 1);
  return new Map(
    (data ?? [])
      .filter((r) => count.get(r.candidate_id) === 1)
      .map((r) => [r.candidate_id, r.id]),
  );
}

// When a conversation was last read: its own mark, or the whole person's older mark from before the split.
export function lastRead(readAt: Map<string, string>, w: Who) {
  const own = readAt.get(whoKey(w));
  const whole = w.t
    ? readAt.get(whoKey({ kind: w.kind, id: w.id }))
    : undefined;
  return own && whole ? (own > whole ? own : whole) : (own ?? whole);
}

export const CLOSED_STAGES = ["passed", "withdrawn"];
const COMPANY_ROLE: Record<string, { text: string; tone: Tone }> = {
  client: { text: "Client", tone: "mint" },
  prospect: { text: "Prospect", tone: "amber" },
  former_client: { text: "Former client", tone: "muted" },
};

export type Person = {
  who: Who;
  name: string;
  role: { text: string; tone: Tone };
  detail: string | null; // company and title for a contact
  jobs: {
    id: string;
    cjId: string;
    title: string;
    company: string | null;
    stage: Database["public"]["Enums"]["pipeline_stage"];
  }[];
};

// Who each conversation is with: candidates with the jobs they're on, contacts with their company.
export async function people(
  supabase: DB,
  list: Who[],
): Promise<Map<string, Person>> {
  const cands = list.filter((w) => w.kind === "c").map((w) => w.id);
  const conts = list.filter((w) => w.kind === "p").map((w) => w.id);
  const [{ data: c }, { data: cj }, { data: p }] = await Promise.all([
    cands.length
      ? supabase.from("candidates").select("id, full_name").in("id", cands)
      : Promise.resolve({ data: [] }),
    cands.length
      ? supabase
          .from("candidate_jobs")
          .select(
            "id, candidate_id, stage, jobs(id, title, companies(name, short_name))",
          )
          .in("candidate_id", cands)
          .not("stage", "in", `(${CLOSED_STAGES.join(",")})`)
      : Promise.resolve({ data: [] }),
    conts.length
      ? supabase
          .from("contacts")
          .select(
            "id, full_name, title, companies!contacts_company_id_fkey(name, status)",
          )
          .in("id", conts)
      : Promise.resolve({ data: [] }),
  ]);
  const out = new Map<string, Person>();
  for (const r of (c ?? []) as { id: string; full_name: string }[]) {
    const jobs = (
      (cj ?? []) as unknown as {
        id: string;
        candidate_id: string;
        stage: Person["jobs"][number]["stage"];
        jobs: {
          id: string;
          title: string;
          companies: { name: string; short_name: string | null } | null;
        } | null;
      }[]
    )
      .filter((x) => x.candidate_id === r.id && x.jobs)
      .map((x) => ({
        id: x.jobs!.id,
        cjId: x.id,
        title: x.jobs!.title,
        company:
          x.jobs!.companies?.short_name || x.jobs!.companies?.name || null,
        stage: x.stage,
      }));
    out.set(`c:${r.id}`, {
      who: { kind: "c", id: r.id },
      name: r.full_name,
      role: { text: "Candidate", tone: "cyan" },
      detail: null,
      jobs,
    });
  }
  for (const r of (p ?? []) as unknown as {
    id: string;
    full_name: string;
    title: string | null;
    companies: { name: string; status: string } | null;
  }[]) {
    out.set(`p:${r.id}`, {
      who: { kind: "p", id: r.id },
      name: r.full_name,
      role: COMPANY_ROLE[r.companies?.status ?? ""] ?? {
        text: "Contact",
        tone: "muted",
      },
      detail: [r.title, r.companies?.name].filter(Boolean).join(" at ") || null,
      jobs: [],
    });
  }
  return out;
}

// How many conversations have a text or email in that Justin hasn't opened yet (the Messages page's Unread count).
export async function unreadConversations(supabase: DB, userId: string) {
  const [{ data: rows }, { data: reads }, sole] = await Promise.all([
    supabase
      .from("activities")
      .select(
        "kind, occurred_at, candidate_id, contact_id, candidate_job_id, external_thread_id",
      )
      .in("kind", ["text", "email"])
      .eq("direction", "in")
      .or("candidate_id.not.is.null,contact_id.not.is.null")
      .order("occurred_at", { ascending: false })
      .limit(1000),
    supabase
      .from("message_reads")
      .select("who, read_at")
      .eq("staff_id", userId),
    soleJobs(supabase),
  ]);
  const readAt = new Map((reads ?? []).map((r) => [r.who, r.read_at]));
  const unread = new Set<string>();
  for (const r of rows ?? []) {
    const w = convOf(r, sole);
    const seen = lastRead(readAt, w);
    if (!seen || r.occurred_at > seen) unread.add(whoKey(w));
  }
  return unread.size;
}

// The cutoff for the Messages page's Current tab.
export const currentSince = (days: number) =>
  new Date(Date.now() - days * 864e5).toISOString();

// An email's real subject: from "Email to/from Name: subject", or the "Subject:" line a submission or relay
// activity carries in its body. Null when neither is there (e.g. "Reply on X's submission from Y").
export function subjectOf(r: { summary: string; body: string | null }) {
  const m = r.summary.match(/^Email (?:to|from) [^:]+:\s*(.+)$/);
  if (m) return m[1].trim();
  const b = (r.body ?? "").match(/^\s*Subject:\s*(.+)$/m);
  return b ? b[1].trim() : null;
}
