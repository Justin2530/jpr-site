import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { accessToken, openToken, readGmail, replyOnly } from "@/lib/google";

// Emails read before the HTML reader learned to drop styles (Devin Yeaney's Indeed message, 2026-10-12) were
// stored as the email's CSS. When one of those is on screen, it is read again from Gmail and saved with the
// sender's actual words, so it only happens once per email.
const CSS = /^\s*(@import|<style|\/\*)|\{[^}]*!important/;

export async function repairEmailBodies<
  R extends {
    id: string;
    kind: string;
    body: string | null;
    external_id?: string | null;
  },
>(supabase: SupabaseClient<Database>, rows: R[]) {
  const bad = rows.filter(
    (r) => r.kind === "email" && r.body && CSS.test(r.body.slice(0, 2000)),
  );
  if (!bad.length) return;
  const ids = new Map<string, string>();
  for (const r of bad) if (r.external_id) ids.set(r.id, r.external_id);
  const missing = bad.filter((r) => !ids.has(r.id)).map((r) => r.id);
  if (missing.length) {
    const { data } = await supabase
      .from("activities")
      .select("id, external_id")
      .in("id", missing);
    for (const a of data ?? []) if (a.external_id) ids.set(a.id, a.external_id);
  }
  const { data: account } = await supabase
    .from("google_accounts")
    .select("token_enc")
    .limit(1)
    .maybeSingle();
  if (!account?.token_enc) return;
  try {
    const token = await accessToken(openToken(account.token_enc));
    for (const r of bad) {
      const gid = ids.get(r.id);
      if (!gid) continue;
      const msg = await readGmail(token, gid);
      const body = (replyOnly(msg.text) || msg.text.trim()).slice(0, 20000);
      if (!body || CSS.test(body.slice(0, 2000))) continue;
      r.body = body;
      await supabase.from("activities").update({ body }).eq("id", r.id);
    }
  } catch (e) {
    console.error("Email re-read failed", e);
  }
}
