import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { accessToken, openToken, sendGmail } from "@/lib/google";
import { toE164, twilioApi, twilioNumber, webhookUrl } from "@/lib/twilio";
import { SIGNATURE } from "@/lib/submission";
import type { Mailbox } from "@/lib/automation";

// Jarvis, Justin's chief of staff (2026-11-12). Justin texts or calls it from his cell on the main line, or
// types and talks to it on the Jarvis page in the Command Center. One brain for all three: it reads the whole
// recruiting database, reasons, and answers. To DO anything it proposes the action, asks "J. P., ... please
// confirm", and only after he confirms does this code (not the model) carry it out, as Justin.

type Db = SupabaseClient<Database>;
export type Channel = "text" | "voice" | "app";

export type Step = {
  kind: "send_text" | "send_email" | "change_data";
  to: string | null; // phone (text) or email address (email)
  to_name: string | null;
  subject: string | null;
  body: string | null;
  sql: string | null;
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

let schemaCache: { at: number; text: string } | null = null;
async function schema(db: Db, secret: string) {
  if (schemaCache && Date.now() - schemaCache.at < 10 * 60_000) return schemaCache.text;
  const text = await call<string>(db, "jarvis_schema", { p_secret: secret });
  schemaCache = { at: Date.now(), text };
  return text;
}

function brief(channel: Channel, schemaText: string) {
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
  const style =
    channel === "text"
      ? "You're answering by text message: plain text, no markdown, no bullet symbols. Short: usually 1 to 4 sentences, up to about 600 characters unless he asks for a full list."
      : channel === "voice"
        ? "Your answer will be SPOKEN to him on a phone call by your voice: write it as 1 to 3 short spoken sentences, no lists, no symbols, no URLs, numbers the way you'd say them. Lead with the answer."
        : "You're answering in a chat panel inside his Command Center: short paragraphs or a short list are fine. Lead with the answer.";
  return `You are Jarvis, the chief of staff for Justin Peace, owner of J-Peace Recruiting LLC ("J. Peace Recruiting", brand JPR) in Punxsutawney, PA. You call him "J. P.". It is ${now} Eastern.

You know his business inside out because you can read its whole database (the Command Center, his CRM and ATS for JPR Local recruiting) with the look_up tool. Never guess a fact you can look up: look it up, then answer. Reason carefully, check your numbers, and if the data doesn't say, say so plainly. You can also search the web for outside questions.

THE BUSINESS (background):
- Four lines on one phone number (814) 845-4341: JPR Local recruiting (the main business; a "USA" market inside it for nationwide machining/manufacturing), JPR AI (AI audits, $497 up to 5 people, $50 per extra), and the JPR Job Board. JPR AI and the Job Board run on separate systems you can't see yet; say so if asked about them.
- Core loop: client > job > candidate > Justin assigns the candidate to the job > automated contact (texts/emails) > short AI screening call > submission draft > Justin's SEND/EDIT/HOLD/PASS > Gmail.
- Recruiting pricing: 20% of first-year pay with a 30-day free replacement, or monthly $1,250 (1 search), $2,500 (up to 3), $3,500 (up to 5), 6+ custom, 6-month terms.
- His AI team, which you can see and direct through the database: Ava the receptionist (reception_calls), the screening agent (screening_runs, screening_facts, pursuits/pursuit_steps for automated outreach), the reply brain and conversation tracker (activities, conversation_states), the client relay (interviews, offers, relay_messages), the inbox agent "Third Eye" (inbox_triaged, inbox_drafts, inbox_labels), the lead engine and registry research (lead_*), and What needs me (action_items with status open). automation_settings holds the master switches.
- Activities is the log of every text, email, call and note; candidate_jobs is a candidate on a job (its stage, automation); submissions are write-ups sent to clients.

HOW YOU WORK:
1. Questions: use look_up (one SELECT per call; you can run as many as you need). Join tables, count, filter by dates. Names are fuzzy: use ilike with % around parts of the name. Keep result sets small (pick columns, add limits).
2. Actions: anything that sends, changes or starts something (texting or emailing someone, changing a stage, assigning a candidate, flipping an automation switch, adding a task or note, booking a call, telling an agent to do something) goes through propose_action, never anything else. First look up what you need (the right person, phone number, email, ids), then call propose_action ONCE with every step of the request and a one-line summary. The app then asks him to confirm and carries it out only after he says confirm. Never claim you did something until you're told it's done.
   - send_text: "to" is the phone number, "body" the exact text. Texts go out from the business number. Write it the way J. P. would: short, friendly, plain. If he dictated the words, use his words.
   - send_email: "to", "subject", "body" (his signature is added for you). Sent from his Gmail.
   - change_data: one SQL statement run as J. P. (INSERT, UPDATE, or SELECT of one of the app's functions listed below). No deletes and no schema changes: for a delete, tell him to use the button in the Command Center. Include every required column on an INSERT. Useful ones:
     * Assign a candidate to a job: insert into candidate_jobs (candidate_id, job_id, assigned_by) values (..., ..., (select id from staff where role='owner' limit 1))
     * Turn automated outreach on/off for a candidate on a job: select set_outreach('<candidate_job id>', true|false). It only starts if the job's own automation switch is on.
     * Job automation switch: select set_job_automation('<job id>', true|false). Master switch: select set_automated_recruiting(true|false). Candidate switch: select set_candidate_automation('<candidate id>', true|false).
     * AI screening call right now: select screening_call_now('<candidate_job id>').
     * A task on What needs me: insert into action_items (title, kind, priority, created_by, market_id) values ('...', 'task', 2, (select id from staff where role='owner' limit 1), (select id from markets limit 1))
     * Move a stage: update candidate_jobs set stage = '<pipeline_stage value>' where id = '...'
   - If something can't be done with these (spending money, buying anything, publishing the website, anything in WellThree, the JPR AI or Job Board systems), say so plainly and offer to put a task on What needs me instead.
3. His rules you keep, even when he asks: never touch anything WellThree. Never recruit from an active client's employees (warn him if a request would). Texts to candidates go 9am to 9pm; if he asks outside that, propose it anyway but mention the time. A submission to a client or anything with offer terms: show him exactly what will go before he confirms. Don't share his personal cell number with anyone.
4. Be direct and useful like a sharp chief of staff: answer, then the one thing he should know. No filler, no "great question". If a request is ambiguous (two Aarons), ask which one, with a detail that tells them apart.

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
              kind: { type: "string", enum: ["send_text", "send_email", "change_data"] },
              to: { type: ["string", "null"], description: "Phone number for send_text, email address for send_email, else null." },
              to_name: { type: ["string", "null"] },
              subject: { type: ["string", "null"] },
              body: { type: ["string", "null"] },
              sql: { type: ["string", "null"], description: "For change_data: the one SQL statement." },
            },
            required: ["kind", "to", "to_name", "subject", "body", "sql"],
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

export function confirmLine(summary: string, channel: Channel) {
  const s = summary.trim().replace(/[.?!]+$/, "");
  return channel === "text"
    ? `J. P., to confirm, you want me to ${s}? Reply "confirm" to go ahead or "cancel".`
    : channel === "voice"
      ? `J. P., to confirm, you want me to ${s}. Please say confirm.`
      : `J. P., to confirm, you want me to ${s}?`;
}

// A fresh snapshot of the things he asks about most, so most questions need no lookups at all (speed).
// Each piece is optional: one that fails is left out and Jarvis looks it up instead.
const SNAPSHOT: Record<string, string> = {
  what_needs_me_open_items: `select kind, title, priority, due_on, created_at::date as created from action_items where status = 'open' order by priority desc, created_at desc limit 30`,
  pipeline: `select c.full_name, c.phone, j.title as job, co.name as company, cj.stage, cj.stage_changed_at::date as since, cj.automate, cj.id as candidate_job_id from candidate_jobs cj join candidates c on c.id = cj.candidate_id join jobs j on j.id = cj.job_id left join companies co on co.id = j.company_id order by cj.stage_changed_at desc nulls last limit 40`,
  jobs: `select j.title, co.name as company, j.status, j.visibility, j.automation_pilot as automation_on, j.location, j.id from jobs j left join companies co on co.id = j.company_id order by j.created_at desc limit 30`,
  screening_calls_recent_and_upcoming: `select c.full_name, j.title as job, r.status, r.scheduled_for, r.call_outcome from screening_runs r join candidate_jobs cj on cj.id = r.candidate_job_id join candidates c on c.id = cj.candidate_id join jobs j on j.id = cj.job_id where coalesce(r.scheduled_for, r.created_at) > now() - interval '3 days' order by coalesce(r.scheduled_for, r.created_at) limit 20`,
  interviews: `select c.full_name, j.title as job, i.status, i.waiting_on, i.scheduled_at from interviews i join candidate_jobs cj on cj.id = i.candidate_job_id join candidates c on c.id = cj.candidate_id join jobs j on j.id = cj.job_id where i.status in ('proposing', 'confirmed') or i.scheduled_at > now() - interval '3 days' order by i.scheduled_at nulls last limit 15`,
  master_switches: `select * from automation_settings limit 1`,
};
async function snapshot(db: Db, secret: string) {
  const parts = await Promise.all(
    Object.entries(SNAPSHOT).map(async ([k, sql]) => {
      try {
        return `${k}: ${JSON.stringify(await call(db, "jarvis_read", { p_secret: secret, p_sql: sql }))}`;
      } catch {
        return null;
      }
    }),
  );
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
            p_summary: String(args.summary),
            p_action: { steps },
          });
          proposed = { id, summary: String(args.summary), action: { steps }, channel, created_at: new Date().toISOString() };
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
      } else if (s.kind === "change_data") {
        if (!s.sql?.trim()) throw new Error("no change given");
        const out = await call(db, "jarvis_write", { p_secret: secret, p_sql: s.sql });
        const n = (out as { rows_changed?: number } | null)?.rows_changed;
        results.push(n === 0 ? "That change matched nothing, so nothing changed." : "Updated the Command Center.");
      }
    } catch (e) {
      failed = true;
      results.push(`Couldn't finish: ${String(e instanceof Error ? e.message : e).slice(0, 200)}.`);
      break;
    }
  }
  const result = results.join(" ");
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
    turn = { reply: `Done, J. P. ${done}`.replace("Done, J. P. Couldn't", "J. P., I couldn't"), pending: null, done };
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
  if (waiting && SAID_CONFIRM.test(text) && !SAID_CANCEL.test(text)) {
    const done = await execute(db, secret, waiting, origin);
    say = `Done. ${done}`;
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
  return `Say this to J. P. now, in your own natural voice, without adding anything: ${say}`;
}

// J. P.'s texts that are meant for Jarvis: they start with "Jarvis", or he's mid-conversation with it.
export function addressedToJarvis(body: string) {
  return /^\s*(hey|hi|ok|okay|yo)?[\s,]*jarvis\b/i.test(body);
}
export function stripName(body: string) {
  return body.replace(/^\s*(hey|hi|ok|okay|yo)?[\s,]*jarvis\b[\s,:.!-]*/i, "").trim() || body.trim();
}
