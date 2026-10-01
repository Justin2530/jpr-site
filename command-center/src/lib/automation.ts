import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { accessToken, googleReady, openToken, sendGmail } from "@/lib/google";
import { toE164, twilioApi, twilioNumber, twilioReady, webhookUrl } from "@/lib/twilio";
import { SIGNATURE } from "@/lib/submission";
import { syncMailbox } from "@/lib/gmail-sync";

// Secret the database uses to call back into this app, derived from a server-only secret so it
// never has to be typed, pasted or stored anywhere but here and in Supabase Vault.
export function automationSecret() {
  const base = process.env.TWILIO_WEBHOOK_SECRET?.trim();
  return base ? createHmac("sha256", base).update("jpr-automation").digest("hex") : null;
}

export function validAutomationSecret(given: string | null) {
  const want = automationSecret();
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Tell the database where to knock every minute. Safe to call often; it only refreshes the values.
export async function registerAutomation(supabase: SupabaseClient<Database>, origin: string) {
  const secret = automationSecret();
  if (!secret) return;
  await supabase.rpc("automation_register", { p_secret: secret, p_url: webhookUrl(origin, "/api/automation/tick") });
}

type Due = {
  step_id: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  sms_opted_out: boolean;
  text_consent: boolean;
  job_title: string;
  location: string | null;
  gmail_email: string | null;
  gmail_token: string | null;
};

function fill(template: string, d: Due) {
  return template
    .replaceAll("{first_name}", d.full_name.trim().split(/\s+/)[0] ?? "there")
    .replaceAll("{job_title}", d.job_title)
    .replaceAll("{in_location}", d.location ? ` in ${d.location}` : "")
    .replaceAll("{signature}", SIGNATURE);
}

// One pass of the follow-up engine: send every text and email that's due, then check each mailbox.
export async function runTick(db: SupabaseClient<Database>, origin: string) {
  const secret = automationSecret()!;
  const { data, error } = await db.rpc("automation_due", { p_secret: secret });
  if (error) throw new Error(error.message);
  const steps = (data ?? []) as unknown as Due[];
  let sent = 0;
  for (const d of steps) {
    const body = fill(d.body, d);
    const done = (
      status: "sent" | "skipped" | "failed",
      note: string,
      extra: { summary?: string; externalId?: string; threadId?: string; phone?: string } = {},
    ) =>
      db.rpc("automation_step_done", {
        p_secret: secret,
        p_step: d.step_id,
        p_status: status,
        p_note: note,
        p_summary: extra.summary ?? "",
        p_body: body,
        p_external_id: extra.externalId ?? "",
        p_thread_id: extra.threadId ?? "",
        p_phone: extra.phone ?? "",
      });
    try {
      if (d.channel === "sms") {
        const to = toE164(d.phone);
        if (!to) await done("skipped", "no mobile number on file");
        else if (d.sms_opted_out) await done("skipped", "they replied STOP");
        else if (!d.text_consent) await done("skipped", "no texting consent on file");
        else if (!twilioReady()) await done("skipped", "texting isn't connected");
        else {
          const msg = await twilioApi("Messages", {
            To: to,
            From: twilioNumber!,
            Body: body,
            StatusCallback: webhookUrl(origin, "/api/twilio/status"),
          });
          await done("sent", "", { summary: `Automatic text to ${d.full_name}`, externalId: msg.sid, phone: to });
          sent++;
        }
      } else {
        const to = d.email?.trim();
        if (!to) await done("skipped", "no email on file");
        else if (!d.gmail_token || !d.gmail_email || !googleReady()) await done("skipped", "Gmail isn't connected");
        else {
          const subject = fill(d.subject ?? "{job_title} position", d);
          const res = await sendGmail(await accessToken(openToken(d.gmail_token)), { from: d.gmail_email, to, subject, body });
          await done("sent", "", { summary: `Automatic email to ${d.full_name}: ${subject}`, externalId: res.id, threadId: res.threadId });
          sent++;
        }
      }
    } catch (e) {
      await done("failed", e instanceof Error ? e.message.slice(0, 300) : "send failed");
    }
  }

  let logged = 0;
  if (googleReady()) {
    const { data: boxes } = await db.rpc("gmail_mailboxes", { p_secret: secret });
    for (const box of (boxes ?? []) as unknown as Mailbox[]) {
      try {
        logged += await syncMailbox(db, secret, box);
      } catch (e) {
        console.error("Gmail check failed for", box.email, e);
      }
    }
  }
  return { sent, due: steps.length, logged };
}

export type Mailbox = { staff_id: string; email: string; token: string; connected_at: string; last_synced_at: string | null };
