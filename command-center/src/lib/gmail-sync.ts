import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { accessToken, gmailLabel, labelThread, listGmail, openToken, readGmail, replyOnly } from "@/lib/google";
import type { Mailbox } from "@/lib/automation";
import { labelOnly, watchInbox, type InboxMessage } from "@/lib/third-eye";

// Pull new mail between one mailbox and known candidates and contacts into the Command Center.
// The database (gmail_log) decides who each message belongs to; only people already on file are
// logged and the rest of the inbox is never stored. Mail they send becomes an incoming email on
// their profile plus a What needs me item (and stops any automated outreach to them); mail sent from
// Gmail directly is logged as outgoing. Emails the app sent are already logged under the same Gmail id.
export async function syncMailbox(db: SupabaseClient<Database>, secret: string, box: Mailbox) {
  const startedAt = new Date();
  const since = box.last_synced_at
    ? new Date(box.last_synced_at).getTime() - 5 * 60_000
    : new Date(box.connected_at).getTime() - 14 * 24 * 3600_000;
  const token = await accessToken(openToken(box.token));
  const ids = await listGmail(token, `after:${Math.floor(since / 1000)} -in:spam -in:trash -in:chats`, 100);
  let fresh = ids;
  if (ids.length) {
    const { data: known } = await db.rpc("gmail_known", { p_secret: secret, p_ids: ids.map((m) => m.id) });
    const seen = new Set(known ?? []);
    fresh = ids.filter((m) => !seen.has(m.id));
  }
  const { messages, inbox } = await readAll(token, fresh);
  await linkIndeed(db, secret, box, messages);
  // The third eye files potential candidates first, so the log below finds them and uses their own words.
  try {
    const filed = await watchInbox(db, secret, box, token, inbox);
    for (const m of messages as { id: string; body: string; filed?: boolean; summary?: string }[]) {
      const f = filed.get(m.id);
      if (f) Object.assign(m, { filed: true, summary: f.summary, body: f.body });
    }
  } catch (e) {
    console.error("Third eye failed", e);
  }
  const { data, error } = await db.rpc("gmail_log", {
    p_secret: secret,
    p_staff: box.staff_id,
    p_me: box.email,
    p_msgs: messages as unknown as Json,
    p_synced_at: startedAt.toISOString(),
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

// Indeed replies come from a relay address; link it to the candidate so the reply is logged and
// later emails go back into their Indeed thread.
async function linkIndeed(
  db: SupabaseClient<Database>,
  secret: string,
  box: Mailbox,
  messages: { from: string; fromName: string; threadId: string; subject: string }[],
) {
  for (const m of messages) {
    if (/@indeedemail\.com$/i.test(m.from) && m.from.toLowerCase() !== box.email.toLowerCase()) {
      const { error } = await db.rpc("gmail_indeed_link", {
        p_secret: secret,
        p_from: m.from,
        p_name: m.fromName ?? "",
        p_thread: m.threadId,
        p_subject: m.subject ?? "",
      });
      if (error) console.error("Indeed link failed", error.message);
    }
  }
}

async function readAll(token: string, ids: { id: string }[]) {
  const messages: { id: string; threadId: string; from: string; fromName: string; to: string[]; subject: string; date: number; body: string }[] = [];
  const inbox: InboxMessage[] = [];
  for (const m of ids) {
    const msg = await readGmail(token, m.id);
    inbox.push({
      id: msg.id,
      threadId: msg.threadId,
      from: msg.from,
      fromName: msg.fromName,
      subject: msg.subject,
      date: msg.date.getTime(),
      text: msg.text,
      bulk: msg.bulk,
    });
    messages.push({
      id: msg.id,
      threadId: msg.threadId,
      from: msg.from,
      fromName: msg.fromName,
      to: msg.to,
      subject: msg.subject,
      date: msg.date.getTime(),
      body: (replyOnly(msg.text) || msg.text.trim()).slice(0, 20000),
    });
  }
  return { messages, inbox };
}

// Re-reads older mail with the third eye, oldest first, a few dozen messages per tick, when a backfill
// was asked for (google_accounts.backfill_from/to). Nothing is filed twice: mail already logged or
// already read by the third eye is skipped, and only what it files is logged, so old mail from people
// already on file doesn't come back as new items.
export async function backfillMailbox(db: SupabaseClient<Database>, secret: string, box: Mailbox) {
  const { data } = await db.rpc("gmail_backfill_get", { p_secret: secret, p_staff: box.staff_id });
  const range = data as { from: string; to: string } | null;
  if (!range) return 0;
  const from = new Date(range.from).getTime();
  const end = Math.min(from + 6 * 3600_000, new Date(range.to).getTime());
  const token = await accessToken(openToken(box.token));
  const ids = await listGmail(
    token,
    `after:${Math.floor(from / 1000)} before:${Math.ceil(end / 1000)} -in:spam -in:trash -in:chats`,
    500,
  );
  let fresh = ids;
  if (ids.length) {
    const { data: known } = await db.rpc("gmail_known", { p_secret: secret, p_ids: ids.map((m) => m.id) });
    const seen = new Set(known ?? []);
    fresh = ids.filter((m) => !seen.has(m.id));
  }
  // Gmail lists newest first; take the oldest 25 so the window can move forward to the last one read.
  const batch = fresh.slice(-25).reverse();
  const { messages, inbox } = await readAll(token, batch);
  const filed = await watchInbox(db, secret, box, token, inbox, true);
  await linkIndeed(db, secret, box, messages.filter((m) => filed.has(m.id)));
  const logged = messages.filter((m) => filed.has(m.id)).map((m) => ({ ...m, ...filed.get(m.id), filed: true }));
  if (logged.length) {
    const { error } = await db.rpc("gmail_log", {
      p_secret: secret,
      p_staff: box.staff_id,
      p_me: box.email,
      p_msgs: logged as unknown as Json,
      p_synced_at: box.last_synced_at ?? new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }
  const next = fresh.length > batch.length ? Math.max(from + 1000, ...inbox.map((m) => m.date)) : end;
  await db.rpc("gmail_backfill_set", { p_secret: secret, p_staff: box.staff_id, p_from: new Date(next).toISOString() });
  return filed.size;
}

// Gmail labels so Justin can pick people out of a busy inbox at a glance: candidates (in the Command Center or
// not yet), current clients and potential clients. The inbox watcher notes each such thread (inbox_label_put);
// this works out which label each should have now and fixes any that are missing or out of date, so a
// candidate's label flips by itself once he adds them. Mail the watcher read before labels existed is picked
// up a few at a time.
export const LABELS = {
  needs: { name: "Candidate - not in system", color: { backgroundColor: "#fb4c2f", textColor: "#ffffff" } },
  in: { name: "Candidate - in system", color: { backgroundColor: "#4a86e8", textColor: "#ffffff" } },
  client: { name: "Client", color: { backgroundColor: "#0b804b", textColor: "#ffffff" } },
  prospect: { name: "Potential client", color: { backgroundColor: "#fad165", textColor: "#000000" } },
} as const;
type LabelKey = keyof typeof LABELS;

export async function labelMailbox(db: SupabaseClient<Database>, secret: string, box: Mailbox) {
  const token = await accessToken(openToken(box.token));
  const { data: backlog } = await db.rpc("inbox_label_backlog", { p_secret: secret });
  for (const id of backlog ?? []) {
    try {
      const m = await readGmail(token, id);
      await db.rpc("inbox_label_put", { p_secret: secret, p_staff: box.staff_id, p_thread: m.threadId, p_gmail: m.id, p_from: m.from, p_name: m.fromName });
    } catch {
      // Gone from Gmail: remember it so it isn't looked up again.
      await db.rpc("inbox_label_put", { p_secret: secret, p_staff: box.staff_id, p_thread: `x:${id}`, p_gmail: id, p_from: "", p_name: "" });
      await db.rpc("inbox_label_done", { p_secret: secret, p_staff: box.staff_id, p_thread: `x:${id}`, p_state: "skip" });
    }
  }
  const { data: due } = await db.rpc("inbox_label_due", { p_secret: secret, p_staff: box.staff_id });
  if (!due?.length) return 0;
  const ids = {} as Record<LabelKey, string>;
  try {
    for (const k of Object.keys(LABELS) as LabelKey[]) ids[k] = await gmailLabel(token, LABELS[k].name, LABELS[k].color);
  } catch (e) {
    // Most likely Gmail was connected before label permission was asked for; reconnecting fixes it.
    console.error("Gmail labels unavailable", e instanceof Error ? e.message : e);
    for (const r of due) await db.rpc("inbox_label_done", { p_secret: secret, p_staff: box.staff_id, p_thread: r.thread_id, p_state: null as unknown as string });
    return 0;
  }
  let n = 0;
  for (const r of due) {
    const want = (r.want in LABELS ? r.want : "needs") as LabelKey;
    try {
      await labelThread(token, r.thread_id, [ids[want]], (Object.keys(LABELS) as LabelKey[]).filter((k) => k !== want).map((k) => ids[k]));
      await db.rpc("inbox_label_done", { p_secret: secret, p_staff: box.staff_id, p_thread: r.thread_id, p_state: want });
      n++;
    } catch (e) {
      console.error("Couldn't label thread", r.thread_id, e instanceof Error ? e.message : e);
      await db.rpc("inbox_label_done", { p_secret: secret, p_staff: box.staff_id, p_thread: r.thread_id, p_state: null as unknown as string });
    }
  }
  return n;
}

// Works back through older mail (label_backfill, Sept 1 on) a 6-hour window at a time, oldest 25 unread-by-us
// messages per tick, putting the same Gmail labels on candidate and client threads. Labels only.
export async function labelBackfill(db: SupabaseClient<Database>, secret: string, box: Mailbox) {
  const { data } = await db.rpc("label_backfill_get", { p_secret: secret, p_staff: box.staff_id });
  const range = data as { from: string; to: string } | null;
  if (!range) return 0;
  const from = new Date(range.from).getTime();
  const end = Math.min(from + 6 * 3600_000, new Date(range.to).getTime());
  const token = await accessToken(openToken(box.token));
  const ids = await listGmail(
    token,
    `after:${Math.floor(from / 1000)} before:${Math.ceil(end / 1000)} -in:spam -in:trash -in:chats -category:promotions -category:social`,
    500,
  );
  let fresh = ids;
  if (ids.length) {
    const { data: known } = await db.rpc("inbox_label_known", { p_secret: secret, p_ids: ids.map((m) => m.id) });
    const seen = new Set(known ?? []);
    fresh = ids.filter((m) => !seen.has(m.id));
  }
  const batch = fresh.slice(-25).reverse();
  const { inbox } = await readAll(token, batch);
  const n = await labelOnly(db, secret, box, inbox);
  const next = fresh.length > batch.length ? Math.max(from + 1000, ...inbox.map((m) => m.date)) : end;
  await db.rpc("label_backfill_set", { p_secret: secret, p_staff: box.staff_id, p_from: new Date(next).toISOString() });
  return n;
}

// Submissions Justin sent from his own Gmail: a candidate moved to Submitted (or later) with no submission sent
// from the Command Center gets his Sent mail searched for an email to that client (a contact's address or their
// company domain) naming the candidate. The one found is recorded as the submission, thread and all, so the
// client follow-up and interview scheduling work for it like any other.
export async function findManualSubmissions(db: SupabaseClient<Database>, secret: string, box: Mailbox) {
  const { data } = await db.rpc("manual_submissions_due", { p_secret: secret });
  const due = (data ?? []) as unknown as { cj_id: string; full_name: string; title: string; since: string; emails: string[] }[];
  if (!due.length) return;
  const token = await accessToken(openToken(box.token));
  const free = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|comcast|verizon|att)\./i;
  for (const d of due) {
    if (!d.emails.length) continue;
    const domains = [...new Set(d.emails.filter((e) => !free.test(e)).map((e) => e.split("@")[1]))];
    const to = [...d.emails.map((e) => `to:${e}`), ...domains.map((x) => `to:${x}`)].join(" OR ");
    const after = Math.floor(new Date(d.since).getTime() / 1000) - 21 * 86400;
    const ids = await listGmail(token, `in:sent (${to}) "${d.full_name.replace(/"/g, "")}" after:${after}`, 5);
    if (!ids.length) continue;
    const msgs = (await Promise.all(ids.map((m) => readGmail(token, m.id).catch(() => null)))).filter(
      (m): m is NonNullable<typeof m> => Boolean(m),
    );
    const sub = msgs.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
    if (!sub) continue;
    const { data: saved, error } = await db.rpc("manual_submission_record", {
      p_secret: secret,
      p_cj: d.cj_id,
      p_thread: sub.threadId,
      p_subject: sub.subject,
      p_sent_at: sub.date.toISOString(),
      p_to: sub.to,
    });
    if (error) console.error(`Couldn't record ${d.full_name}'s submission from Gmail`, error.message);
    else if (saved) console.log(`Recorded ${d.full_name}'s ${d.title} submission from Gmail (${sub.subject})`);
  }
}
