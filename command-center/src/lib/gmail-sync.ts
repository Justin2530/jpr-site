import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { accessToken, listGmail, openToken, readGmail, replyOnly } from "@/lib/google";
import type { Mailbox } from "@/lib/automation";
import { watchInbox, type InboxMessage } from "@/lib/third-eye";

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
  const messages = [];
  const inbox: InboxMessage[] = [];
  for (const m of fresh) {
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
  // Indeed replies come from a relay address; link it to the candidate so the reply is logged and
  // later emails go back into their Indeed thread.
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
