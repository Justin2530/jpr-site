import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { accessToken, listGmail, openToken, readGmail, replyOnly } from "@/lib/google";
import type { Mailbox } from "@/lib/automation";

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
  for (const m of fresh) {
    const msg = await readGmail(token, m.id);
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
