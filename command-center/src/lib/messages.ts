import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Tone } from "@/lib/format";

type DB = SupabaseClient<Database>;

// A conversation key: "c-<candidate id>" or "p-<contact id>" in URLs, "c:<id>" / "p:<id>" in message_reads.
export type Who = { kind: "c" | "p"; id: string };
export const whoKey = (w: Who) => `${w.kind}:${w.id}`;
export const whoPath = (w: Who) => `/messages/${w.kind}-${w.id}`;
export function parseWho(key: string): Who | null {
  const m = key.match(/^([cp])-([0-9a-f-]{36})$/i);
  return m ? { kind: m[1] as "c" | "p", id: m[2] } : null;
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
  jobs: { id: string; cjId: string; title: string; company: string | null; stage: Database["public"]["Enums"]["pipeline_stage"] }[];
};

// Who each conversation is with: candidates with the jobs they're on, contacts with their company.
export async function people(supabase: DB, list: Who[]): Promise<Map<string, Person>> {
  const cands = list.filter((w) => w.kind === "c").map((w) => w.id);
  const conts = list.filter((w) => w.kind === "p").map((w) => w.id);
  const [{ data: c }, { data: cj }, { data: p }] = await Promise.all([
    cands.length ? supabase.from("candidates").select("id, full_name").in("id", cands) : Promise.resolve({ data: [] }),
    cands.length
      ? supabase
          .from("candidate_jobs")
          .select("id, candidate_id, stage, jobs(id, title, companies(name, short_name))")
          .in("candidate_id", cands)
          .not("stage", "in", `(${CLOSED_STAGES.join(",")})`)
      : Promise.resolve({ data: [] }),
    conts.length
      ? supabase.from("contacts").select("id, full_name, title, companies!contacts_company_id_fkey(name, status)").in("id", conts)
      : Promise.resolve({ data: [] }),
  ]);
  const out = new Map<string, Person>();
  for (const r of (c ?? []) as { id: string; full_name: string }[]) {
    const jobs = ((cj ?? []) as unknown as {
      id: string;
      candidate_id: string;
      stage: Person["jobs"][number]["stage"];
      jobs: { id: string; title: string; companies: { name: string; short_name: string | null } | null } | null;
    }[])
      .filter((x) => x.candidate_id === r.id && x.jobs)
      .map((x) => ({
        id: x.jobs!.id,
        cjId: x.id,
        title: x.jobs!.title,
        company: x.jobs!.companies?.short_name || x.jobs!.companies?.name || null,
        stage: x.stage,
      }));
    out.set(`c:${r.id}`, { who: { kind: "c", id: r.id }, name: r.full_name, role: { text: "Candidate", tone: "cyan" }, detail: null, jobs });
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
      role: COMPANY_ROLE[r.companies?.status ?? ""] ?? { text: "Contact", tone: "muted" },
      detail: [r.title, r.companies?.name].filter(Boolean).join(" at ") || null,
      jobs: [],
    });
  }
  return out;
}

// How many conversations have a text or email in that Justin hasn't opened yet (the Messages page's Unread count).
export async function unreadConversations(supabase: DB, userId: string) {
  const [{ data: rows }, { data: reads }] = await Promise.all([
    supabase
      .from("activities")
      .select("occurred_at, candidate_id, contact_id")
      .in("kind", ["text", "email"])
      .eq("direction", "in")
      .or("candidate_id.not.is.null,contact_id.not.is.null")
      .order("occurred_at", { ascending: false })
      .limit(1000),
    supabase.from("message_reads").select("who, read_at").eq("staff_id", userId),
  ]);
  const readAt = new Map((reads ?? []).map((r) => [r.who, r.read_at]));
  const unread = new Set<string>();
  for (const r of rows ?? []) {
    const key = whoKey(r.contact_id ? { kind: "p", id: r.contact_id } : { kind: "c", id: r.candidate_id! });
    const seen = readAt.get(key);
    if (!seen || r.occurred_at > seen) unread.add(key);
  }
  return unread.size;
}
