import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type Line = { speaker: "agent" | "candidate"; text: string; at?: number };
export type CorrItem = {
  id: string;
  kind: "call" | "text" | "email" | "ai_call";
  at: string;
  direction: string | null;
  summary: string;
  body: string | null;
  duration: number | null;
  context: string | null;
  by: string | null;
  transcript?: Line[];
};

type DB = SupabaseClient<Database>;
const CONVERSATION = ["call", "text", "email"];
const SELECT =
  "id, kind, summary, body, direction, duration_seconds, occurred_at, contacts(full_name), candidates(full_name), jobs(title), staff(full_name, email)";

type Row = {
  id: string;
  kind: string;
  summary: string;
  body: string | null;
  direction: string | null;
  duration_seconds: number | null;
  occurred_at: string;
  contacts: { full_name: string } | null;
  candidates: { full_name: string } | null;
  jobs: { title: string } | null;
  staff: { full_name: string | null; email: string } | null;
};

function fromActivity(a: Row, show: "contact" | "candidate" | "job"): CorrItem {
  const context = show === "contact" ? a.contacts?.full_name : show === "candidate" ? a.candidates?.full_name : a.jobs?.title;
  return {
    id: a.id,
    kind: a.kind as CorrItem["kind"],
    at: a.occurred_at,
    direction: a.direction,
    summary: a.summary,
    body: a.body,
    duration: a.duration_seconds,
    context: context ?? null,
    by: a.staff ? (a.staff.full_name ?? a.staff.email.split("@")[0]) : null,
  };
}

const newestFirst = (a: CorrItem, b: CorrItem) => b.at.localeCompare(a.at);

// Candidate: calls, texts and emails with them, plus every AI pre-submission call across their jobs.
export async function candidateCorrespondence(supabase: DB, candidateId: string): Promise<CorrItem[]> {
  const [{ data: acts }, { data: runs }] = await Promise.all([
    supabase
      .from("activities")
      .select(SELECT)
      .eq("candidate_id", candidateId)
      .in("kind", CONVERSATION)
      .order("occurred_at", { ascending: false })
      .limit(200),
    supabase
      .from("screening_runs")
      .select("id, status, started_at, created_at, duration_seconds, summary, transcript, candidate_jobs!inner(candidate_id, jobs(title))")
      .eq("candidate_jobs.candidate_id", candidateId),
  ]);
  const calls: CorrItem[] = (runs ?? []).map((r) => ({
    id: r.id,
    kind: "ai_call",
    at: r.started_at ?? r.created_at,
    direction: "out",
    summary:
      r.status === "completed"
        ? "Pre-submission call"
        : r.status === "no_answer"
          ? "Pre-submission call: no answer"
          : `Pre-submission call: ${r.status.replace(/_/g, " ")}`,
    body: r.summary,
    duration: r.duration_seconds,
    context: r.candidate_jobs?.jobs?.title ?? null,
    by: "JPR assistant",
    transcript: Array.isArray(r.transcript) ? (r.transcript as Line[]) : [],
  }));
  return [...((acts ?? []) as unknown as Row[]).map((a) => fromActivity(a, "job")), ...calls].sort(newestFirst);
}

export async function contactCorrespondence(supabase: DB, contactId: string): Promise<CorrItem[]> {
  const { data } = await supabase
    .from("activities")
    .select(SELECT)
    .eq("contact_id", contactId)
    .in("kind", CONVERSATION)
    .order("occurred_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as unknown as Row[]).map((a) => fromActivity(a, "candidate"));
}

// Company: everything with its people (client side, not candidates).
export async function companyCorrespondence(supabase: DB, companyId: string): Promise<CorrItem[]> {
  const { data } = await supabase
    .from("activities")
    .select(SELECT)
    .eq("company_id", companyId)
    .in("kind", CONVERSATION)
    .not("contact_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as unknown as Row[]).map((a) => fromActivity(a, "contact"));
}

// Deal: conversations logged on the deal or with its contact.
export async function dealCorrespondence(supabase: DB, dealId: string, contactId: string | null): Promise<CorrItem[]> {
  const filter = contactId ? `deal_id.eq.${dealId},contact_id.eq.${contactId}` : `deal_id.eq.${dealId}`;
  const { data } = await supabase
    .from("activities")
    .select(SELECT)
    .or(filter)
    .in("kind", CONVERSATION)
    .order("occurred_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as unknown as Row[]).map((a) => fromActivity(a, "contact"));
}
