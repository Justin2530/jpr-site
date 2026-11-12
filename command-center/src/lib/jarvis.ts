import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { accessToken, openToken, sendGmail } from "@/lib/google";
import { toE164, twilioApi, twilioNumber, webhookUrl } from "@/lib/twilio";
import { SIGNATURE } from "@/lib/submission";
import type { Mailbox } from "@/lib/automation";
import { addGoogleEvent, googleEvents, type CalEvent } from "@/lib/calendar";

// Jarvis, Justin's chief of staff (2026-11-12). Justin texts or calls it from his cell on the main line, or
// types and talks to it on the Jarvis page in the Command Center. One brain for all three: it reads the whole
// recruiting database, reasons, and answers. To DO anything it proposes the action, asks "J. P., ... please
// confirm", and only after he confirms does this code (not the model) carry it out, as Justin.

type Db = SupabaseClient<Database>;
export type Channel = "text" | "voice" | "app";

export type Step = {
  kind: "send_text" | "send_email" | "change_data" | "calendar_event";
  to: string | null; // phone (text) or email address (email)
  to_name: string | null;
  subject: string | null;
  body: string | null;
  sql: string | null;
  start?: string | null; // calendar_event: Eastern wall time, YYYY-MM-DDTHH:MM
  minutes?: number | null; // calendar_event: length
};
export type Pending = { id: string; summary: string; action: { steps: Step[] }; channel: Channel; created_at: string };
export type Turn = { reply: string; pending: Pending | null; done?: string };

// gpt-5-mini by default to go easy on the OpenAI credit the phone agents share; OPENAI_JARVIS_MODEL=gpt-5 for more horsepower.
const model = () => process.env.OPENAI_JARVIS_MODEL?.trim() || "gpt-5-mini";

// The new database functions aren't in the generated types yet.
async function call<T = unknown>(db: Db, fn: string, args: Record<string, unknown>) {
  const { data, error } = await (db.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }>)(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export const CONFIRM = /^\s*(please\s+)?(confirm(ed)?|yes|yep|yeah|yup|do it|go ahead|send it|ok(ay)?|sure)\b[\s.!]*(\bjarvis\b)?[\s.!]*$/i;
export const CANCEL = /^\s*(cancel|no|nope|stop|don'?t|never\s?mind|hold( off)?)\b/i;
// On a call the words come from the transcript, mid-sentence: "yeah, confirm" or "confirm, thanks".
const SAID_CONFIRM = /\bconfirm(ed)?\b/i;
const SAID_CANCEL = /\b(cancel|never ?mind|don'?t do (it|that)|hold off)\b/i;
// On a call he often answers the confirm with "yep" or "yes, do it" instead of the word confirm (2026-11-12). That
// counts, as long as it's right after the question and he isn't changing or asking something.
const SAID_YES = /\b(yes|yep|yeah|yup|do it|go ahead|sounds good|that'?s (right|correct)|correct)\b/i;
const SAID_CHANGE = /\b(but|instead|change|actually|wait|no|not|don'?t|rather|make it|switch|what|where|who|why|how|which)\b|\?/i;
function saidYes(text: string, waiting: Pending) {
  if (SAID_CANCEL.test(text)) return false;
  if (SAID_CONFIRM.test(text)) return true;
  const fresh = Date.now() - new Date(waiting.created_at).getTime() < 5 * 60_000;
  return fresh && SAID_YES.test(text) && !SAID_CHANGE.test(text) && text.split(/\s+/).length <= 25;
}

let schemaCache: { at: number; text: string } | null = null;
async function schema(db: Db, secret: string) {
  if (schemaCache && Date.now() - schemaCache.at < 10 * 60_000) return schemaCache.text;
  const text = await call<string>(db, "jarvis_schema", { p_secret: secret });
  schemaCache = { at: Date.now(), text };
  return text;
}

// "This week", "last week": spelled out so he and Jarvis count weeks the same way (Monday to Sunday).
function weeks() {
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const monday = new Date(ny);
  monday.setDate(ny.getDate() - ((ny.getDay() + 6) % 7));
  const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const span = (back: number) => {
    const a = new Date(monday);
    a.setDate(monday.getDate() - 7 * back);
    const b = new Date(a);
    b.setDate(a.getDate() + 6);
    return `${day(a)} to ${day(b)}`;
  };
  return `This week is ${span(0)}. Last week was ${span(1)}. The week before that was ${span(2)}. Next week is ${span(-1)}.`;
}

function brief(channel: Channel, schemaText: string) {
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
  const style =
    channel === "text"
      ? "You're answering by text message: plain text, no markdown, no bullet symbols. Short: usually 1 to 4 sentences, up to about 600 characters unless he asks for a full list."
      : channel === "voice"
        ? "Your answer will be SPOKEN to him on a phone call: talk like a relaxed friend who works for him, plain everyday words, contractions, no corporate phrasing. At most 2 short sentences (under 35 words). Say dates like \"last Thursday\" or \"November sixth\", never the year. Never read out email addresses, phone numbers, ids or dollar ranges unless he asks for them. Don't start with \"J. P.,\" every time. No lists, no symbols, no dashes."
        : "You're answering in a chat panel inside his Command Center: short paragraphs or a short list are fine. Lead with the answer.";
  return `You are Jarvis, the chief of staff for Justin Peace, owner of J-Peace Recruiting LLC ("J. Peace Recruiting", brand JPR) in Punxsutawney, PA. You call him "J. P.". It is ${now} Eastern. ${weeks()}

You know his business inside out because you can read its whole database (the Command Center, his CRM and ATS for JPR Local recruiting) with the look_up tool. Never guess a fact you can look up: look it up, then answer. Reason carefully, check your numbers, and if the data doesn't say, say so plainly. You can also search the web for outside questions.

THE BUSINESS (background):
- Four lines on one phone number (814) 845-4341: JPR Local recruiting (the main business; a "USA" market inside it for nationwide machining/manufacturing), JPR AI (AI audits, $497 up to 5 people, $50 per extra), and the JPR Job Board. JPR AI and the Job Board run on separate systems you can't see yet; say so if asked about them.
- Core loop: client > job > candidate > Justin assigns the candidate to the job > automated contact (texts/emails) > short AI screening call > submission draft > Justin's SEND/EDIT/HOLD/PASS > Gmail.
- Recruiting pricing: 20% of first-year pay with a 30-day free replacement, or monthly $1,250 (1 search), $2,500 (up to 3), $3,500 (up to 5), 6+ custom, 6-month terms.
- His AI team, which you can see and direct through the database: Ava the receptionist (reception_calls), the screening agent (screening_runs, screening_facts, pursuits/pursuit_steps for automated outreach), the reply brain and conversation tracker (activities, conversation_states), the client relay (interviews, offers, relay_messages), the inbox agent "Third Eye" (inbox_triaged, inbox_drafts, inbox_labels), the lead engine and registry research (lead_*), and What needs me (action_items with status open). automation_settings holds the master switches.
- His calendar: command_center_calendar (interviews, screening calls, tasks with due dates, deal steps) and his own Google Calendar are both in the snapshot. "What's on my calendar" means both. The Command Center calendar shows his Google Calendar events at their time slots; tasks have no time, so they sit in the all-day row at the top.
- "Messages" means texts and emails people sent in (activities with direction 'in'; messages_in_last_14_days in the snapshot), not only what's on What needs me.
- Activities is the log of every text, email, call and note; candidate_jobs is a candidate on a job (its stage, automation); submissions are write-ups sent to clients.

HOW YOU WORK:
1. Questions: use look_up (one SELECT per call; you can run as many as you need). Join tables, count, filter by dates. Names are fuzzy: use ilike with % around parts of the name. On calls his words come from speech-to-text, so names get misheard ("John Abis" was really "Joanne Bish"): if a name finds nothing, look for names that sound alike before saying there's no match. Keep result sets small (pick columns, add limits). For "this week" or "last week", use the exact dates above and check every item's date against them.
2. Actions: anything that sends, changes or starts something (texting or emailing someone, changing a stage, assigning a candidate, flipping an automation switch, adding a task or note, booking a call, telling an agent to do something) goes through propose_action, never anything else. First look up what you need (the right person, phone number, email, ids), then call propose_action ONCE with every step of the request and a one-line summary. The app then asks him to confirm and carries it out only after he says confirm. Never ask him to "say confirm" yourself and never offer to do something: if he wants it done, call propose_action. Never claim you did something until you're told it's done. Before adding something, check it isn't already there; if it is, fix that one instead of adding another.
   - send_text: "to" is the phone number, "body" the exact text. Texts go out from the business number. Write it the way J. P. would: short, friendly, plain. If he dictated the words, use his words.
   - send_email: "to", "subject", "body" (his signature is added for you). Sent from his Gmail.
   - calendar_event: something at a set time ("lunch at 12:30", "call Bob tomorrow at 3"). "subject" is the event title, "start" the Eastern date and time as YYYY-MM-DDTHH:MM, "minutes" how long (30 if he doesn't say), "body" optional notes. It goes on his Google Calendar and shows at that time slot on the Command Center calendar. Whenever he gives a time, use calendar_event, never a task.
   - change_data: one SQL statement run as J. P. (INSERT, UPDATE, or SELECT of one of the app's functions listed below). No deletes and no schema changes: for a delete, tell him to use the button in the Command Center. Include every required column on an INSERT. Useful ones:
     * Assign a candidate to a job: insert into candidate_jobs (candidate_id, job_id, assigned_by) values (..., ..., (select id from staff where role='owner' limit 1))
     * Turn automated outreach on/off for a candidate on a job: select set_outreach('<candidate_job id>', true|false). It only starts if the job's own automation switch is on.
     * Job automation switch: select set_job_automation('<job id>', true|false). Master switch: select set_automated_recruiting(true|false). Candidate switch: select set_candidate_automation('<candidate id>', true|false).
     * AI screening call right now: select screening_call_now('<candidate_job id>').
     * A to-do with no time on What needs me: insert into action_items (title, kind, priority, created_by, market_id) values ('...', 'task', 2, (select id from staff where role='owner' limit 1), (select id from markets limit 1))
     * Move a stage: update candidate_jobs set stage = '<pipeline_stage value>' where id = '...'
   - If something can't be done with these (spending money, buying anything, publishing the website, anything in WellThree, the JPR AI or Job Board systems), say so plainly and offer to put a task on What needs me instead.
3. His rules you keep, even when he asks: never touch anything WellThree. Never recruit from an active client's employees (warn him if a request would). Texts to candidates go 9am to 9pm; if he asks outside that, propose it anyway but mention the time. A submission to a client or anything with offer terms: show him exactly what will go before he confirms. Don't share his personal cell number with anyone.
4. Answer exactly what he asked and stop. Don't tack on other items, "one thing" tips, suggestions, or offers ("want me to...?") he didn't ask for; he'll ask if he wants more. Only add something unasked if it's urgent and directly about what he asked. No filler, no "great question". If a request is ambiguous (two Aarons), ask which one, with a detail that tells them apart.
5. Words he uses: a "lead" is a NEW business prospect: a website hiring request (action_items kind 'website_lead', titled "Hiring request: ..."), an employer who wrote in but isn't a client yet, or a Lead Engine business that replied. Replies from clients (like Ciarra Goodlin at ACME/ALKAB) and from candidates are recruiting work, never leads. Something is still a lead only while it's open (status 'open'); if it's resolved or dismissed, say so instead of listing it as current. A "client" is a company with an active agreement or jobs with us.

${style}

DATABASE MAP (tables and views with their columns, enum values, and the app's functions):
${schemaText}`;
}

const TOOLS = [
  {
    type: "function",
    name: "look_up",
    description: "Run one read-only SQL SELECT on the business database and get the rows back as JSON (max 200 rows).",
    strict: true,
    parameters: {
      type: "object",
      properties: { sql: { type: "string", description: "One SELECT (or WITH ... SELECT) statement. Postgres." } },
      required: ["sql"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "propose_action",
    description:
      "Propose what J. P. asked you to do. Nothing happens until he confirms; the app asks him and then runs every step in order.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            'What you will do, phrased to finish the sentence "J. P., to confirm, you want me to ...", e.g. "text Aaron Jackson: \\"Running 10 minutes late\\"". Include exact message wording when short.',
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["send_text", "send_email", "change_data", "calendar_event"] },
              to: { type: ["string", "null"], description: "Phone number for send_text, email address for send_email, else null." },
              to_name: { type: ["string", "null"] },
              subject: { type: ["string", "null"] },
              body: { type: ["string", "null"] },
              sql: { type: ["string", "null"], description: "For change_data: the one SQL statement." },
              start: { type: ["string", "null"], description: "For calendar_event: Eastern date and time, YYYY-MM-DDTHH:MM. Else null." },
              minutes: { type: ["integer", "null"], description: "For calendar_event: length in minutes. Else null." },
            },
            required: ["kind", "to", "to_name", "subject", "body", "sql", "start", "minutes"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "steps"],
      additionalProperties: false,
    },
  },
];

type Item = Record<string, unknown> & { type?: string };

async function respond(body: Record<string, unknown>) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as { output?: Item[] };
}

// The brain sometimes writes the whole confirm question into the summary ("J. P., to confirm, you want me to ...");
// keep only the part after it so the question is never said twice.
export function cleanSummary(summary: string) {
  return summary
    .trim()
    .replace(/^(?:(?:j\.?\s*p\.?|justin)\s*,?\s*)?(?:(?:just\s+)?to\s+confirm\s*,?\s*)?(?:(?:you\s+want\s+me\s+to|i(?:'ll|\s+will)|i\s+am\s+going\s+to)\s+)?/i, "")
    .replace(/[\s.?!]*(?:please\s+say\s+confirm|reply\s+"?confirm"?.*)[\s.?!]*$/i, "")
    .replace(/[.?!]+$/, "")
    .trim();
}

export function confirmLine(summary: string, channel: Channel) {
  const s = cleanSummary(summary);
  return channel === "text"
    ? `J. P., to confirm, you want me to ${s}? Reply "confirm" to go ahead or "cancel".`
    : channel === "voice"
      ? `J. P., to confirm, you want me to ${s}. Please say confirm.`
      : `J. P., to confirm, you want me to ${s}?`;
}

// A fresh snapshot of the things he asks about most, so most questions need no lookups at all (speed).
// Each piece is optional: one that fails is left out and Jarvis looks it up instead.
const SNAPSHOT: Record<string, string> = {
  what_needs_me_open_items: `select kind, title, priority, due_on, (created_at at time zone 'America/New_York')::date as created from action_items where status = 'open' order by priority desc, created_at desc limit 30`,
  website_leads_last_90_days: `select (created_at at time zone 'America/New_York')::date as came_in, status, title from action_items where kind = 'website_lead' and created_at > now() - interval '90 days' order by created_at desc`,
  messages_in_last_14_days: `select (a.occurred_at at time zone 'America/New_York')::date as day, a.kind, coalesce(c.full_name, ct.full_name, a.phone_number) as who, left(coalesce(a.summary, a.body), 140) as about from activities a left join candidates c on c.id = a.candidate_id left join contacts ct on ct.id = a.contact_id where a.direction = 'in' and a.kind in ('text', 'email') and a.occurred_at > now() - interval '14 days' order by a.occurred_at desc limit 40`,
  pipeline: `select c.full_name, c.phone, j.title as job, co.name as company, cj.stage, cj.stage_changed_at::date as since, cj.automate, cj.id as candidate_job_id from candidate_jobs cj join candidates c on c.id = cj.candidate_id join jobs j on j.id = cj.job_id left join companies co on co.id = j.company_id order by cj.stage_changed_at desc nulls last limit 40`,
  jobs: `select j.title, co.name as company, j.status, j.visibility, j.automation_pilot as automation_on, j.location, j.id from jobs j left join companies co on co.id = j.company_id order by j.created_at desc limit 30`,
  screening_calls_recent_and_upcoming: `select c.full_name, j.title as job, r.status, r.scheduled_for, r.call_outcome from screening_runs r join candidate_jobs cj on cj.id = r.candidate_job_id join candidates c on c.id = cj.candidate_id join jobs j on j.id = cj.job_id where coalesce(r.scheduled_for, r.created_at) > now() - interval '3 days' order by coalesce(r.scheduled_for, r.created_at) limit 20`,
  interviews: `select c.full_name, j.title as job, i.status, i.waiting_on, i.scheduled_at from interviews i join candidate_jobs cj on cj.id = i.candidate_job_id join candidates c on c.id = cj.candidate_id join jobs j on j.id = cj.job_id where i.status in ('proposing', 'confirmed') or i.scheduled_at > now() - interval '3 days' order by i.scheduled_at nulls last limit 15`,
  master_switches: `select * from automation_settings limit 1`,
  command_center_calendar_next_3_weeks: `select e->>'kind' as kind, e->>'title' as title, e->>'start' as start, e->>'date' as date, e->>'minutes' as minutes, e->>'detail' as detail, e->>'done' as done from jsonb_array_elements(calendar_events(now() - interval '1 day', now() + interval '21 days')) e order by coalesce(e->>'start', e->>'date')`,
};

// His own Google Calendar (the same events the Calendar page shows in gray), next three weeks.
async function googleCalendar(db: Db, secret: string) {
  try {
    const boxes = await call<Mailbox[]>(db, "gmail_mailboxes", { p_secret: secret });
    if (!boxes?.[0]) return null;
    const now = Date.now();
    const events: CalEvent[] = await googleEvents(boxes[0].token, new Date(now - 86_400_000), new Date(now + 21 * 86_400_000));
    return `his_google_calendar_next_3_weeks: ${JSON.stringify(events.map((e) => ({ title: e.title, start: e.start, date: e.date, minutes: e.minutes, where: e.detail || undefined })))}`;
  } catch (e) {
    return `his_google_calendar_next_3_weeks: couldn't read it (${String(e instanceof Error ? e.message : e).slice(0, 80)})`;
  }
}
async function snapshot(db: Db, secret: string) {
  const parts = await Promise.all([
    ...Object.entries(SNAPSHOT).map(async ([k, sql]) => {
      try {
        return `${k}: ${JSON.stringify(await call(db, "jarvis_read", { p_secret: secret, p_sql: sql }))}`;
      } catch {
        return null;
      }
    }),
    googleCalendar(db, secret),
  ]);
  return parts.filter(Boolean).join("\n").slice(0, 40_000);
}

// One turn of thinking: J. P. said something, Jarvis looks things up and answers, maybe proposing an action.
export async function think(db: Db, secret: string, channel: Channel, said: string, deadlineMs = 50_000): Promise<Turn> {
  const started = Date.now();
  const [history, schemaText, waiting, snap] = await Promise.all([
    call<{ at: string; channel: string; role: string; content: string }[]>(db, "jarvis_recent", { p_secret: secret, p_limit: 30 }),
    schema(db, secret),
    call<Pending | null>(db, "jarvis_pending", { p_secret: secret }),
    snapshot(db, secret),
  ]);
  const input: Item[] = (history ?? []).map((m) => ({
    role: m.role === "jp" ? "user" : "assistant",
    content: `${m.role === "jp" ? `[${m.channel}, ${new Date(m.at).toLocaleString("en-US", { timeZone: "America/New_York" })}] ` : ""}${m.content}`,
  }));
  if (waiting)
    input.push({
      role: "developer",
      content: `Still waiting on his confirm: "${waiting.summary}". If he's changing it, propose the new version (it replaces this one). If he's moved on, just answer.`,
    });
  if (snap)
    input.push({
      role: "developer",
      content: `LIVE SNAPSHOT, read from the database just now (use it directly; look up anything it doesn't cover):\n${snap}`,
    });
  input.push({ role: "user", content: said });

  let proposed: Pending | null = null;
  let reply = "";
  const tools: Item[] = [...TOOLS, ...(process.env.JARVIS_WEB_SEARCH === "off" ? [] : [{ type: "web_search" }])];
  for (let round = 0; round < 12; round++) {
    const out = await respond({
      model: model(),
      instructions: brief(channel, schemaText),
      input,
      tools,
      reasoning: { effort: channel === "voice" ? "low" : "medium" },
      store: false,
      include: ["reasoning.encrypted_content"],
    });
    const items = out.output ?? [];
    input.push(...items);
    const calls = items.filter((i) => i.type === "function_call") as (Item & { name: string; arguments: string; call_id: string })[];
    reply = items
      .flatMap((i) => (i.type === "message" ? ((i.content as { type: string; text?: string }[]) ?? []) : []))
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    if (!calls.length) break;
    for (const c of calls) {
      let output: string;
      try {
        const args = JSON.parse(c.arguments);
        if (c.name === "look_up") {
          const rows = await call(db, "jarvis_read", { p_secret: secret, p_sql: String(args.sql) });
          output = JSON.stringify(rows).slice(0, 30_000);
        } else if (c.name === "propose_action") {
          const steps = (args.steps ?? []) as Step[];
          if (!steps.length) throw new Error("No steps.");
          const id = await call<string>(db, "jarvis_propose", {
            p_secret: secret,
            p_channel: channel,
            p_summary: cleanSummary(String(args.summary)),
            p_action: { steps },
          });
          proposed = { id, summary: cleanSummary(String(args.summary)), action: { steps }, channel, created_at: new Date().toISOString() };
          output = "Saved. The app will ask J. P. to confirm. Don't call propose_action again this turn; reply with anything else he needs to know in one short line, or nothing.";
        } else output = "Unknown tool.";
      } catch (e) {
        output = `Error: ${String(e instanceof Error ? e.message : e).slice(0, 500)}`;
      }
      input.push({ type: "function_call_output", call_id: c.call_id, output });
    }
    if (Date.now() - started > deadlineMs) {
      input.push({ role: "developer", content: "Out of time: answer now with what you have." });
    }
  }
  if (proposed) {
    const p = proposed as Pending;
    const ask = confirmLine(p.summary, channel);
    reply = reply && !/confirm/i.test(reply) ? `${reply}\n\n${ask}` : ask;
  }
  if (!reply) reply = "Sorry J. P., I came up empty on that one. Try asking another way?";
  return { reply, pending: proposed };
}

const digits10 = (p: string) => p.replace(/\D/g, "").slice(-10);

// Carry out a confirmed action, step by step. Returns a short account of what happened.
export async function execute(db: Db, secret: string, p: Pending, origin: string | null): Promise<string> {
  const claimed = await call<boolean>(db, "jarvis_decide", { p_secret: secret, p_id: p.id, p_status: "running" });
  if (!claimed) return "That one was already handled.";
  const results: string[] = [];
  let failed = false;
  let nothing = false;
  for (const s of p.action.steps) {
    try {
      if (s.kind === "send_text") {
        const to = toE164(s.to);
        if (!to || !s.body?.trim()) throw new Error("no phone number or message");
        const out = await call<{ opted_out: boolean | null }[]>(db, "jarvis_read", {
          p_secret: secret,
          p_sql: `select bool_or(sms_opted_out) as opted_out from candidates where right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = '${digits10(to)}'`,
        });
        if (out?.[0]?.opted_out) throw new Error(`${s.to_name ?? to} texted STOP, so texts to them are blocked`);
        const msg = await twilioApi("Messages", {
          To: to,
          From: twilioNumber ?? "",
          Body: s.body.trim(),
          ...(origin ? { StatusCallback: webhookUrl(origin, "/api/twilio/status") } : {}),
        });
        await db.rpc("twilio_log_relay", {
          p_secret: process.env.TWILIO_WEBHOOK_SECRET ?? "",
          p_sid: msg.sid,
          p_to: to,
          p_body: s.body.trim(),
        });
        results.push(`Texted ${s.to_name ?? to}.`);
      } else if (s.kind === "send_email") {
        if (!s.to || !s.body?.trim()) throw new Error("no email address or message");
        const boxes = await call<Mailbox[]>(db, "gmail_mailboxes", { p_secret: secret });
        const box = boxes?.[0];
        if (!box) throw new Error("Gmail isn't connected");
        const token = await accessToken(openToken(box.token));
        await sendGmail(token, {
          from: box.email,
          to: s.to,
          subject: s.subject?.trim() || "JPR",
          body: `${s.body.trim()}\n\n${SIGNATURE}`,
        });
        results.push(`Emailed ${s.to_name ?? s.to}.`);
      } else if (s.kind === "calendar_event") {
        if (!s.subject?.trim() || !s.start?.trim()) throw new Error("no title or time for the event");
        const boxes = await call<Mailbox[]>(db, "gmail_mailboxes", { p_secret: secret });
        if (!boxes?.[0]) throw new Error("Google isn't connected");
        await addGoogleEvent(boxes[0].token, { title: s.subject.trim(), start: s.start, minutes: s.minutes || 30, notes: s.body });
        results.push(`Put "${s.subject.trim()}" on your calendar.`);
      } else if (s.kind === "change_data") {
        if (!s.sql?.trim()) throw new Error("no change given");
        const out = await call(db, "jarvis_write", { p_secret: secret, p_sql: s.sql });
        const n = (out as { rows_changed?: number } | null)?.rows_changed;
        if (n === 0) nothing = true;
        results.push("");
      }
    } catch (e) {
      failed = true;
      results.push(`Couldn't finish: ${String(e instanceof Error ? e.message : e).slice(0, 200)}.`);
      break;
    }
  }
  // Say what was actually done, in his words from the confirm, not "Updated the Command Center".
  const what = cleanSummary(p.summary);
  const partial = results.filter((r) => r && !r.startsWith("Couldn't")).join(" ");
  const result = failed
    ? `J. P., I couldn't finish that: ${results[results.length - 1].replace(/^Couldn't finish: /, "")}${partial ? ` Already done: ${partial}` : ""}`
    : nothing
      ? `Heads up: nothing matched, so nothing changed (${what}).`
      : `Done: ${what}.`;
  await call(db, "jarvis_decide", { p_secret: secret, p_id: p.id, p_status: failed ? "failed" : "done", p_result: result });
  return result;
}

const log = (db: Db, secret: string, channel: Channel, role: "jp" | "jarvis", content: string) =>
  call(db, "jarvis_log", { p_secret: secret, p_channel: channel, p_role: role, p_content: content }).catch((e) =>
    console.error("Jarvis log failed", e),
  );

// A message from J. P. (text or the Command Center): a confirm or cancel for what's waiting, or a new turn.
export async function handle(db: Db, secret: string, channel: Channel, said: string, origin: string | null): Promise<Turn> {
  const text = said.trim();
  await log(db, secret, channel, "jp", text);
  const waiting = await call<Pending | null>(db, "jarvis_pending", { p_secret: secret });
  let turn: Turn;
  if (waiting && CONFIRM.test(text)) {
    const done = await execute(db, secret, waiting, origin);
    turn = { reply: done, pending: null, done };
  } else if (waiting && CANCEL.test(text) && text.split(/\s+/).length <= 4) {
    await call(db, "jarvis_decide", { p_secret: secret, p_id: waiting.id, p_status: "cancelled" });
    turn = { reply: "Cancelled. Nothing was sent or changed.", pending: null };
  } else {
    turn = await think(db, secret, channel, text);
  }
  await log(db, secret, channel, "jarvis", turn.reply);
  return turn;
}

// On a call: what he said since the last hand-off decides it. A confirm runs the waiting action; anything else
// is thought through. The answer goes back to the voice as its "thinking", for it to say out loud.
export async function handleVoice(db: Db, secret: string, heard: string, origin: string | null): Promise<string> {
  const text = heard.trim();
  const waiting = await call<Pending | null>(db, "jarvis_pending", { p_secret: secret });
  if (text) await log(db, secret, "voice", "jp", text);
  let say: string;
  if (waiting && saidYes(text, waiting)) {
    say = await execute(db, secret, waiting, origin);
  } else if (waiting && SAID_CANCEL.test(text)) {
    await call(db, "jarvis_decide", { p_secret: secret, p_id: waiting.id, p_status: "cancelled" });
    say = "Cancelled, nothing was sent or changed.";
  } else if (!text) {
    say = "You didn't catch anything new from J. P.; ask him what he needs.";
    return say;
  } else {
    const turn = await think(db, secret, "voice", text, 25_000);
    say = turn.reply;
  }
  await log(db, secret, "voice", "jarvis", say);
  if (say.startsWith("Done: "))
    return `Tell J. P. it's done, in your own natural voice, in one short past-tense sentence (like "Done, lunch is on your calendar at twelve thirty."). What you did: ${say.slice(6)}`;
  return `Say this to J. P. now, in your own natural voice, without adding anything: ${say}`;
}

// J. P.'s texts that are meant for Jarvis: they start with "Jarvis", or he's mid-conversation with it.
export function addressedToJarvis(body: string) {
  return /^\s*(hey|hi|ok|okay|yo)?[\s,]*jarvis\b/i.test(body);
}
export function stripName(body: string) {
  return body.replace(/^\s*(hey|hi|ok|okay|yo)?[\s,]*jarvis\b[\s,:.!-]*/i, "").trim() || body.trim();
}
