import { createHmac, timingSafeEqual } from "node:crypto";
import { runBrain } from "@/lib/brain";
import { runTriage } from "@/lib/triage";
import { runScreening } from "@/lib/screening";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { accessToken, googleReady, openToken, sendGmail } from "@/lib/google";
import { toE164, twilioApi, twilioNumber, twilioReady, webhookUrl } from "@/lib/twilio";
import { SIGNATURE } from "@/lib/submission";
import { syncMailbox } from "@/lib/gmail-sync";
import { runRelay } from "@/lib/relay";

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
  channel: "sms" | "email" | "call" | "close";
  in_thread: boolean;
  subject: string | null;
  body: string;
  candidate_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  sms_opted_out: boolean;
  source: "indeed" | "applied" | "linkedin" | "referral" | "other";
  job_title: string;
  location: string | null;
  compensation: string | null;
  schedule: string | null;
  job_summary: string | null;
  thread_id: string | null;
  thread_subject: string | null;
  gmail_email: string | null;
  gmail_token: string | null;
};

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

// "near Punxsutawney" from "Punxsutawney, PA": the town, never the client.
export function nearTown(location: string | null) {
  const town = location?.split(",")[0]?.trim();
  return town ? ` near ${town}` : "";
}

// The first line after "this is Justin with JPR", by how they came to the job (picked at assign).
export function opener(source: Due["source"], jobTitle: string, location: string | null) {
  const job = `${article(jobTitle)} ${jobTitle} position we're hiring for${nearTown(location)}`;
  switch (source) {
    case "indeed":
      return `I reached out to you on Indeed about ${job}, and got your response that you might be interested.`;
    case "linkedin":
      return `I reached out to you on LinkedIn about ${job}, and got your response that you might be interested.`;
    case "applied":
      return `I got your application for the ${jobTitle} position we're hiring for${nearTown(location)}.`;
    case "referral":
      return `I was told you might be interested in ${job}.`;
    default:
      return `I reached out to you about ${job}, and got your response that you might be interested.`;
  }
}

// Pay, schedule and a couple of points from what candidates can be told about the job.
export function jobDetails(d: Pick<Due, "compensation" | "schedule" | "job_summary">) {
  const lines: string[] = [];
  if (d.compensation?.trim()) lines.push(`Pay: ${d.compensation.trim()}`);
  if (d.schedule?.trim()) lines.push(`Schedule: ${d.schedule.trim()}`);
  const summary = d.job_summary?.trim() ?? "";
  const bullets = summary
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*\u2022]\s+/.test(l))
    .map((l) => l.replace(/^[-*\u2022]\s+/, ""));
  const points = bullets.length
    ? bullets
    : (summary.replace(/\s+/g, " ").match(/[^.!?]+[.!?]/g) ?? []).map((x) => x.trim()).filter((x) => x.length > 20);
  lines.push(...points.slice(0, 2));
  return lines.length ? `A few details on the job:\n${lines.map((l) => `- ${l}`).join("\n")}\n\n` : "";
}

function fill(template: string, d: Due) {
  return template
    .replaceAll("{first_name}", d.full_name.trim().split(/\s+/)[0] ?? "there")
    .replaceAll("{job_title}", d.job_title)
    .replaceAll("{near_town}", nearTown(d.location))
    .replaceAll("{in_location}", d.location ? ` in ${d.location}` : "")
    .replaceAll("{opener}", opener(d.source, d.job_title, d.location))
    .replaceAll("{job_details}", jobDetails(d))
    .replaceAll("{signature}", SIGNATURE);
}

// One pass of the follow-up engine: send every text and email that's due, then check each mailbox.
export async function runTick(db: SupabaseClient<Database>, origin: string) {
  const secret = automationSecret()!;
  // A day after a missed booked call with no reply, the outreach schedule picks up where it stopped.
  const { error: resumeError } = await db.rpc("pursuits_resume_due", { p_secret: secret });
  if (resumeError) console.error("Resuming outreach failed", resumeError.message);
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
      if (d.channel === "call") {
        // The database books the AI call; the screening engine dials it on this same tick.
        if (!toE164(d.phone)) await done("skipped", "no phone number on file");
        else await done("sent", "");
      } else if (d.channel === "close") {
        await done("sent", ""); // moves them to Couldn't contact
      } else if (d.channel === "sms") {
        const to = toE164(d.phone);
        if (!to) await done("skipped", "no mobile number on file");
        else if (d.sms_opted_out) await done("skipped", "they replied STOP");
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
        // Someone who replied on Indeed gets every email in their Indeed thread, even once we have their own address.
        const { data: indeed } = await db.rpc("automation_indeed", { p_secret: secret, p_candidate: d.candidate_id });
        const relay = indeed as { relay: string; thread_id: string; subject: string | null } | null;
        const to = relay?.relay ?? d.email?.trim();
        if (!to) await done("skipped", "no email on file");
        else if (!d.gmail_token || !d.gmail_email || !googleReady()) await done("skipped", "Gmail isn't connected");
        else {
          // Follow-ups reply in the first email's thread, so the whole run reads as one conversation.
          const thread = relay
            ? { id: relay.thread_id, subject: relay.subject ?? fill("{job_title}{near_town}", d) }
            : d.in_thread && d.thread_id && d.thread_subject
              ? { id: d.thread_id, subject: d.thread_subject }
              : null;
          const subject = thread ? `Re: ${thread.subject.replace(/^Re:\s*/i, "")}` : fill(d.subject ?? "{job_title}{near_town}", d);
          const res = await sendGmail(await accessToken(openToken(d.gmail_token)), {
            from: d.gmail_email,
            to,
            subject,
            body,
            ...(thread ? { threadId: thread.id } : {}),
          });
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
  // Hiring requests from the website also go to Justin's inbox, with Reply-To set to the employer.
  let leads = 0;
  try {
    leads = await emailWebsiteLeads(db, secret, origin);
  } catch (e) {
    console.error("Website lead email failed", e);
  }
  // Replies the sync just logged get read by the brain right away.
  let brain = 0;
  try {
    brain = await runBrain(db, secret, origin);
  } catch (e) {
    console.error("Brain pass failed", e);
  }
  // Submissions, interviews and offers: client follow-ups, the scheduling relay, reminders and check-ins.
  let relay = 0;
  try {
    relay = await runRelay(db, secret, origin);
  } catch (e) {
    console.error("Relay pass failed", e);
  }
  // Screening calls whose time has come, and write-ups of calls that just ended.
  let calls = { dialed: 0, processed: 0 };
  try {
    calls = await runScreening(db, secret, origin);
  } catch (e) {
    console.error("Screening pass failed", e);
  }
  // Then everything else that came in: only what needs Justin stays on What needs me.
  let cleared = 0;
  try {
    cleared = await runTriage(db, secret);
  } catch (e) {
    console.error("Triage pass failed", e);
  }
  return { sent, due: steps.length, logged, leads, brain, relay, cleared, calls };
}

async function emailWebsiteLeads(db: SupabaseClient<Database>, secret: string, origin: string) {
  if (!googleReady()) return 0;
  const { data } = await db.rpc("website_leads_unsent", { p_secret: secret });
  const items = (data ?? []) as unknown as { id: string; title: string; detail: string | null }[];
  if (!items.length) return 0;
  const { data: boxes } = await db.rpc("gmail_mailboxes", { p_secret: secret });
  const box = ((boxes ?? []) as unknown as Mailbox[])[0];
  if (!box) return 0;
  const token = await accessToken(openToken(box.token));
  let sent = 0;
  for (const item of items) {
    const replyTo = item.detail?.match(/^Email: (\S+@\S+\.\S+)$/m)?.[1] ?? null;
    const body = `${item.title.replace(/^Hiring request: /, "New hiring request from ")} on jpeacerecruiting.com.\n\n${item.detail ?? ""}\n\n${
      replyTo ? "Reply to this email to answer them directly.\n" : ""
    }It's also on What needs me: ${origin}/`;
    await sendGmail(token, { from: box.email, to: box.email, replyTo, subject: item.title.replace(/^Hiring request/, "Website hiring request"), body });
    await db.rpc("website_lead_notified", { p_secret: secret, p_item: item.id });
    sent++;
  }
  return sent;
}

export type Mailbox = { staff_id: string; email: string; token: string; connected_at: string; last_synced_at: string | null };
