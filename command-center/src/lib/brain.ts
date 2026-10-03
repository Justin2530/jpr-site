import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { accessToken, googleReady, openToken, sendGmail } from "@/lib/google";
import { toE164, twilioApi, twilioNumber, twilioReady, webhookUrl } from "@/lib/twilio";
import { SIGNATURE } from "@/lib/submission";

// The "brain": reads each reply from a candidate in screening and decides the next step toward the
// goal (a booked screening call). The engine does the sending and the database does the bookkeeping.

type Pending = {
  activity_id: string;
  channel: "text" | "email";
  body: string | null;
  summary: string;
  thread_id: string | null;
  from_phone: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  sms_opted_out: boolean;
  candidate_job_id: string;
  job_title: string;
  company: string;
  location: string | null;
  compensation: string | null;
  schedule: string | null;
  job_summary: string | null;
  gmail_email: string | null;
  gmail_token: string | null;
  history: { at: string; kind: string; direction: string | null; text: string | null }[];
};

type Decision = {
  intent: "book_call" | "ask_time" | "not_interested" | "needs_justin";
  call_at_local: string;
  summary: string;
  reply: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["book_call", "ask_time", "not_interested", "needs_justin"] },
    call_at_local: { type: "string" },
    summary: { type: "string" },
    reply: { type: "string" },
  },
  required: ["intent", "call_at_local", "summary", "reply"],
};

function nowEastern() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const RULES = `You are the scheduling assistant for JPR, a small recruiting firm in Punxsutawney, PA run by Justin Peace.
JPR reached out to a candidate about a job. The goal right now is one thing: book a short phone screening call (about 10 minutes) with them.
Read their latest reply in context and choose ONE intent:
- book_call: they gave a specific day and time that works for a call (or clearly accepted one we offered). Put it in call_at_local as "YYYY-MM-DD HH:MM" (24-hour, Eastern time). Resolve words like "tomorrow" or "Tuesday" against the current date given. Calls only Monday-Saturday 8am-7pm; if they ask for outside that, use ask_time instead.
- ask_time: they're interested or want to talk but gave no usable time ("sure", "call me", "afternoons are good", "this week"). Reply proposing two specific times in the next two business days.
- not_interested: they clearly said no, not looking, already took a job, or asked us to stop.
- needs_justin: anything else: questions about pay beyond what's listed, benefits details not listed, the client's name if not given, negotiating, complaints, confusion, someone else answering, or anything you're unsure of.
reply: the message to send back, written as Justin. Warm, short, plain, like a real local recruiter texting. No emojis, no exclamation-point spam, no corporate phrases.
- book_call: confirm the day and time in words (e.g. "Tuesday at 3pm") and say we'll call the number we have on file.
- ask_time: offer two specific times in words.
- not_interested: thank them in one sentence and say you'll keep them in mind.
- needs_justin: leave reply empty; Justin answers himself.
For a text reply keep it under 300 characters and don't sign it. For an email reply write 2-4 short sentences with no greeting line beyond "Hi {first name}," and no signature (it's added).
Never invent facts about the job, pay, benefits or company beyond what's given. Never promise an interview or a job.
summary: one short line for Justin's dashboard saying what they said and what you did (e.g. "Booked screening Tue 3pm" or "Asked about weekend pay").`;

async function decide(p: Pending): Promise<Decision | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const context = {
    now_eastern: nowEastern(),
    candidate: p.full_name,
    their_latest_reply: { channel: p.channel, text: p.body ?? p.summary },
    earlier_messages: p.history,
    job: {
      title: p.job_title,
      company: p.company,
      location: p.location,
      pay: p.compensation,
      schedule: p.schedule,
      summary: p.job_summary,
    },
  };
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      instructions: RULES,
      input: JSON.stringify(context),
      text: { format: { type: "json_schema", name: "decision", schema: SCHEMA, strict: true } },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const out = (data.output ?? [])
    .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
    .find((c: { type: string }) => c.type === "output_text")?.text;
  const d = JSON.parse(out) as Decision;
  if (d.intent === "book_call" && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d.call_at_local)) d.intent = "ask_time";
  return d;
}

function subjectOf(summary: string) {
  const s = summary.replace(/^[^:]*:\s*/, "").trim() || "Phone call";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

// One pass: decide and act on every waiting reply. Anything that fails lands on What needs me as before.
export async function runBrain(db: SupabaseClient<Database>, secret: string, origin: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) return 0;
  const { data, error } = await db.rpc("brain_pending", { p_secret: secret });
  if (error) throw new Error(error.message);
  let handled = 0;
  for (const p of (data ?? []) as unknown as Pending[]) {
    const apply = (d: Record<string, string>) =>
      db.rpc("brain_apply", { p_secret: secret, p_activity: p.activity_id, p_decision: { candidate_job_id: p.candidate_job_id, ...d } });
    try {
      const d = await decide(p);
      if (!d) continue;
      const extra: Record<string, string> = {};
      const reply = d.intent === "needs_justin" ? "" : d.reply.trim();
      if (reply) {
        if (p.channel === "text") {
          const to = toE164(p.phone ?? p.from_phone);
          if (to && !p.sms_opted_out && twilioReady()) {
            const msg = await twilioApi("Messages", {
              To: to,
              From: twilioNumber!,
              Body: reply,
              StatusCallback: webhookUrl(origin, "/api/twilio/status"),
            });
            Object.assign(extra, { reply_channel: "text", reply_body: reply, reply_external_id: msg.sid, reply_phone: to });
          }
        } else if (p.email && p.gmail_email && p.gmail_token && googleReady()) {
          const body = `${reply}\n\n${SIGNATURE}`;
          const sent = await sendGmail(await accessToken(openToken(p.gmail_token)), {
            from: p.gmail_email,
            to: p.email,
            subject: subjectOf(p.summary),
            body,
            threadId: p.thread_id ?? undefined,
          });
          Object.assign(extra, { reply_channel: "email", reply_body: body, reply_external_id: sent.id, reply_thread_id: sent.threadId });
        }
      }
      // A reply we meant to send but couldn't means Justin should look.
      const intent = reply && !extra.reply_body ? "needs_justin" : d.intent;
      await apply({ intent, call_at_local: d.call_at_local, summary: d.summary });
      handled++;
    } catch (e) {
      console.error("Brain failed on", p.activity_id, e);
      await apply({ intent: "needs_justin", summary: "Couldn't read this reply automatically" });
    }
  }
  return handled;
}
