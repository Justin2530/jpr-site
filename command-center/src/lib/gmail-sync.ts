import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { accessToken, listGmail, openToken, readGmail, replyOnly } from "@/lib/google";

type Person = { id: string; name: string; email: string; kind: "candidate" | "contact"; companyId: string | null; marketId: string | null };

// Pull new mail between this mailbox and known candidates and contacts into the Command Center.
// Only people already on file are logged; the rest of the inbox is never stored. Mail they send
// becomes an incoming email on their profile plus a What needs me item; mail Justin sends them
// from Gmail directly is logged as outgoing. Emails the app sent are already logged (same Gmail id).
export async function syncGmail(supabase: SupabaseClient<Database>, userId: string) {
  const { data: account } = await supabase
    .from("google_accounts")
    .select("email, token_enc, connected_at, last_synced_at")
    .eq("staff_id", userId)
    .maybeSingle();
  if (!account) return 0;
  const startedAt = new Date();
  const since = account.last_synced_at
    ? new Date(account.last_synced_at).getTime() - 5 * 60_000
    : new Date(account.connected_at).getTime() - 14 * 24 * 3600_000;
  const token = await accessToken(openToken(account.token_enc));
  const ids = await listGmail(token, `after:${Math.floor(since / 1000)} -in:spam -in:trash -in:chats`, 100);

  const fresh = ids.length
    ? await (async () => {
        const { data: seen } = await supabase
          .from("activities")
          .select("external_id")
          .in(
            "external_id",
            ids.map((m) => m.id),
          );
        const known = new Set((seen ?? []).map((r) => r.external_id));
        return ids.filter((m) => !known.has(m.id));
      })()
    : [];

  const me = account.email.toLowerCase();
  const messages = [];
  for (const m of fresh) messages.push(await readGmail(token, m.id));
  const addresses = [...new Set(messages.flatMap((m) => (m.from === me ? m.to : [m.from])).filter((a) => a && a !== me))];
  const people = await findPeople(supabase, addresses);

  const threads = [...new Set(messages.map((m) => m.threadId))];
  const { data: subs } = threads.length
    ? await supabase
        .from("submissions")
        .select("email_thread_id, candidate_job_id, candidate_jobs(candidate_id, job_id, candidates(full_name))")
        .in("email_thread_id", threads)
    : { data: [] };
  const bySubThread = new Map((subs ?? []).map((s) => [s.email_thread_id!, s]));

  let added = 0;
  for (const m of messages.sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const outgoing = m.from === me;
    const who = outgoing ? m.to.map((a) => people.get(a)).find(Boolean) : people.get(m.from);
    const sub = bySubThread.get(m.threadId);
    if (!who && !sub) continue;
    const link = sub?.candidate_jobs;
    const body = replyOnly(m.text) || m.text.trim();
    const name = who?.name ?? m.fromName;
    const summary = outgoing
      ? `Email to ${name}: ${m.subject || "(no subject)"}`
      : sub && link?.candidates
        ? `Reply on ${link.candidates.full_name}'s submission from ${name}`
        : `Email from ${name}: ${m.subject || "(no subject)"}`;
    const { error } = await supabase.from("activities").insert({
      kind: "email",
      direction: outgoing ? "out" : "in",
      summary,
      body: body.slice(0, 20000),
      occurred_at: m.date.toISOString(),
      candidate_id: who?.kind === "candidate" ? who.id : (link?.candidate_id ?? null),
      contact_id: who?.kind === "contact" ? who.id : null,
      company_id: who?.companyId ?? null,
      job_id: link?.job_id ?? null,
      candidate_job_id: sub?.candidate_job_id ?? null,
      market_id: who?.marketId ?? null,
      actor_id: outgoing ? userId : null,
      external_id: m.id,
      external_thread_id: m.threadId,
      external_status: outgoing ? "sent" : "received",
    });
    if (error) continue; // most likely already logged by a sync running at the same moment
    added++;
    if (!outgoing) {
      await supabase.from("action_items").insert({
        kind: "reply",
        title: summary.replace(/: .*$/, ""),
        detail: `${m.subject ? `${m.subject}\n` : ""}${body}`.slice(0, 280),
        priority: 1,
        candidate_id: who?.kind === "candidate" ? who.id : (link?.candidate_id ?? null),
        contact_id: who?.kind === "contact" ? who.id : null,
        company_id: who?.companyId ?? null,
        job_id: link?.job_id ?? null,
        candidate_job_id: sub?.candidate_job_id ?? null,
        market_id: who?.marketId ?? null,
      });
    }
  }
  await supabase.from("google_accounts").update({ last_synced_at: startedAt.toISOString() }).eq("staff_id", userId);
  return added;
}

async function findPeople(supabase: SupabaseClient<Database>, addresses: string[]) {
  const found = new Map<string, Person>();
  if (!addresses.length) return found;
  const filter = addresses.map((a) => `email.ilike.${a.replace(/[,()%_*]/g, "")}`).join(",");
  const [{ data: cands }, { data: cons }] = await Promise.all([
    supabase.from("candidates").select("id, full_name, email, source_market_id").or(filter).order("updated_at", { ascending: false }),
    supabase.from("contacts").select("id, full_name, email, company_id, companies(market_id)").or(filter),
  ]);
  // Contacts first, so a client's address resolves to the client even if a candidate shares it.
  for (const c of cons ?? []) {
    const e = c.email?.trim().toLowerCase();
    if (e && !found.has(e))
      found.set(e, {
        id: c.id,
        name: c.full_name,
        email: e,
        kind: "contact",
        companyId: c.company_id,
        marketId: c.companies?.market_id ?? null,
      });
  }
  for (const c of cands ?? []) {
    const e = c.email?.trim().toLowerCase();
    if (e && !found.has(e))
      found.set(e, { id: c.id, name: c.full_name, email: e, kind: "candidate", companyId: null, marketId: c.source_market_id });
  }
  return found;
}
