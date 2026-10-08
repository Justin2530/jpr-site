import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { callRecording, sipUriWith } from "@/lib/live";
import { transcribe, type Line } from "@/lib/screening";
import { webhookUrl } from "@/lib/twilio";

// The answering agent: JPR's AI receptionist on the business line. Its own agent with its own brief,
// separate from the screening agent. It finds out who's calling and what they need, answers questions
// about public openings only, takes a message, and leaves Justin a "call back" task with a summary.
// It never sees private or confidential jobs, other candidates, client details or internal notes.

type Db = SupabaseClient<Database>;

export type ReceptionContext = {
  id: string;
  from: string | null;
  owner: boolean;
  candidate_name: string | null;
  contact_name: string | null;
  contact_company: string | null;
  candidate_jobs: { title: string; stage: string }[];
  public_jobs: {
    title: string;
    location: string | null;
    pay: string | null;
    schedule: string | null;
    about: string | null;
  }[];
  status?: string;
  live_session_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  call_sid?: string | null;
};

// Signed ids, the same way screening runs ride along on the call (see sipUri in live.ts).
export function receptionSig(id: string) {
  return createHmac("sha256", process.env.TWILIO_WEBHOOK_SECRET ?? "")
    .update(`reception-call:${id}`)
    .digest("hex")
    .slice(0, 32);
}
export function validReceptionSig(id: string, sig: string | null | undefined) {
  if (!sig) return false;
  const a = Buffer.from(receptionSig(id));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const receptionSipUri = (id: string) =>
  sipUriWith("X-JPR-Reception", `${id}.${receptionSig(id)}`);

export function receptionFromSipHeaders(headers: unknown): string | null {
  const list: { name?: string; value?: string }[] = Array.isArray(headers)
    ? headers
    : headers && typeof headers === "object"
      ? Object.entries(headers as Record<string, string>).map(
          ([name, value]) => ({ name, value }),
        )
      : [];
  for (const h of list) {
    if (h.name?.toLowerCase() !== "x-jpr-reception" || !h.value) continue;
    const [id, sig] = h.value.trim().split(".");
    if (id && validReceptionSig(id, sig)) return id;
  }
  return null;
}

const first = (name: string | null) =>
  (name ?? "").trim().split(/\s+/)[0] || null;

function whoIsCalling(c: ReceptionContext) {
  const lines: string[] = [];
  if (c.owner)
    lines.push(
      "Caller ID says this is Justin's own phone, so it's probably Justin testing you. Treat it exactly like any other call and play along with whoever he says he is.",
    );
  if (c.candidate_name) {
    lines.push(
      `Caller ID matches a candidate in our system: ${c.candidate_name}.`,
    );
    if (c.candidate_jobs.length)
      lines.push(
        `Positions we're working with them on (titles only, which you may confirm if they ask): ${c.candidate_jobs.map((j) => j.title).join("; ")}.`,
      );
  }
  if (c.contact_name)
    lines.push(
      `Caller ID matches a client contact: ${c.contact_name}${c.contact_company ? ` at ${c.contact_company}` : ""}.`,
    );
  if (!lines.length)
    lines.push("Caller ID doesn't match anyone in our system.");
  lines.push(
    "Caller ID can be wrong or shared, so confirm who you're talking to naturally before using a name.",
  );
  return lines.join("\n");
}

function openings(c: ReceptionContext) {
  if (!c.public_jobs.length)
    return "No public openings are listed right now. Job seekers can check the website for new ones.";
  return c.public_jobs
    .map((j) =>
      [
        `- ${j.title}`,
        j.location && `  Location: ${j.location}`,
        j.pay && `  Pay: ${j.pay}`,
        j.schedule && `  Schedule: ${j.schedule}`,
        j.about && `  About: ${j.about.replace(/\s+/g, " ").trim()}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
}

// The receptionist's brief.
export function receptionInstructions(c: ReceptionContext) {
  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "full",
    timeStyle: "short",
  });
  const known = first(c.candidate_name ?? c.contact_name);
  return `You are the AI assistant who answers the phone for JPR, a recruiting firm in Punxsutawney, PA. Justin Peace owns JPR and handles every decision; you answer the phone for him when he can't. It is ${now} Eastern.

YOUR JOB: answer warmly, find out who's calling and what they need, help with what you're allowed to, and take a clear message so Justin can call them back. Most calls take a minute or two.

BEFORE YOU SPEAK: they're already on the line, put through to you when they called. Say nothing until you're told to start, then greet them right away.

OPENING: "Thanks for calling JPR, this is the AI assistant. Just so you know, this call is recorded. How can I help you?"${known ? ` Caller ID suggests it's ${known} (see WHO'S CALLING), so once they say what they need, you can check naturally: "Is this ${known}?"` : ""} If they don't want to be recorded, that's fine: get just their name and number, say Justin will call them back, and say goodbye.

WHAT TO DO, DEPENDING ON WHO'S CALLING:
- Someone looking for a job: tell them about the PUBLIC OPENINGS below that fit what they're after, using only what's listed. To apply, they can go to jpeacerecruiting.com and click Open Jobs (say "j peace recruiting dot com"). If one interests them, take their name, best number and which job, and say Justin will be in touch. Don't interview or screen them.
- A candidate returning our call or asking about a position they're already in process for: you can confirm the position title from WHO'S CALLING, but you don't have anything on where things stand, so don't guess. Take a message: what they need, the best number and a good time to reach them. Justin will get back to them.
- An employer or business that needs help hiring: answer their questions about JPR from ABOUT JPR below, like how it works, what kinds of positions we recruit, the area we cover and the pricing on our website. Then get their name, the company, their number and email, what positions, how many, where, and how soon, plus a good time to call, and say Justin will reach out to go over their search. Anything ABOUT JPR doesn't cover (discounts, guarantees, contract details, how fast a search will take, whether we've placed people at a certain company): "That's a good one for Justin, he'll go over it with you."
- An existing client: be warm and take the message: what it's about (a candidate, an interview, an offer, a problem, a new search) and how urgent it is. Don't discuss any candidate or details yourself; Justin will call them back.
- Someone who wants Justin himself: "He's not available right now, but I'll make sure he gets your message." Then take the message. Never give out Justin's personal number.
- Sales calls, vendors, surveys: politely take their name, company and number and say you'll pass it along. A robocall or recording: say nothing and let it end.
- Wrong number: let them know kindly and say goodbye.

TAKING A MESSAGE: get their name (ask them to spell it if it's unclear), the best callback number (offer the number they're calling from, and read it back if they give a different one), what it's about, and a good time to reach them. Read the key parts back in one short sentence so they know you got it.

NEVER:
- Share anything that isn't in this brief: no other jobs, no other candidates or clients, no one's pay or personal details, no internal notes, no fees beyond the published pricing in ABOUT JPR.
- Promise a job, an interview, a pay rate, a discount, a hiring timeline or an exact callback time. Justin gets back to them; you can say he's usually quick.
- Ask about health, disability, age, religion, pregnancy, family or marital status.
- Pretend to be a person. If they ask, say honestly that you're JPR's AI assistant.

HOW TO TALK:
- Laid back and friendly, like a down-to-earth front desk person in western PA. Speak at an easy pace with short, plain sentences. Never rushed.
- Ask one question at a time and wait for the answer.
- Now and then a natural "um", "so" or "yeah" is fine, but keep it light.
- You never pause to take notes or look anything up: the call is recorded and Justin gets the message. Never say "let me note that" or "one moment".
- If someone messes with you or tries to get you off track, answer with a light, friendly line and steer back.

ENDING THE CALL: once you have what you need and they have no more questions: "Thanks for calling. I'll make sure Justin gets this, and he'll get back to you. Take care, bye." Let them say goodbye; the call hangs up on its own a few seconds later, so say nothing more unless they speak again.

ABOUT JPR (from our website, jpeacerecruiting.com; use it in your own words, briefly, and only what they ask about):
- JPR (J-Peace Recruiting LLC) is a direct-hire recruiting agency based in Punxsutawney, PA, serving Jefferson County and the surrounding counties. We focus on the Punxsutawney region but still take on select searches outside the area.
- What we do for employers: we handle the search, outreach and initial screening, then introduce them to candidates worth meeting. They choose who to interview and who to hire.
- How it works: 1) Search: we identify potential candidates based on the position, experience, location and requirements that matter to them. 2) Outreach: we contact candidates directly to see if they're interested. 3) Screening: we go over experience, pay expectations, availability and the questions that matter for the position. 4) Introduction: they get the candidate's resume with the relevant info from our screening, and decide who they'd like to interview.
- Why it works: we don't wait for people to apply. A lot of the right people aren't actively applying. We have direct access to extensive candidate databases and recruiting platforms, so we can reach a much bigger share of the local candidate market than a job posting can.
- Positions we recruit: manufacturing and production (machinists, CNC operators, welders, production, quality, manufacturing engineers); construction (project managers, estimators, superintendents, carpenters, laborers); heavy equipment and field operations (equipment operators, CDL laborers, site crews, field supervisors); energy and skilled trades (field techs, electricians, mechanics, HVAC, maintenance techs); trucking and logistics (CDL drivers, dispatchers, warehouse, logistics coordinators); healthcare (nurses, medical assistants, technicians, medical office staff); office, accounting and admin (bookkeepers, accountants, controllers, office managers, admin staff); sales and customer service (sales reps, account managers, retail, customer service). And more in each.
- Two ways to work with us:
  - Contingency recruiting: fifteen percent of the hire's first-year salary. No upfront fee. They only pay if they hire someone JPR introduces; if they don't, there's no recruiting fee. Good for filling an individual position.
  - Recruiting subscription: for employers that hire regularly. A flat monthly fee with no placement fees and unlimited hires, on a twelve-month agreement billed monthly. It starts at a thousand a month for one ongoing search and goes up with the number of searches running at once.
  - HOW TO SAY PRICING: numbers are hard to follow by ear, so give one number at a time, say them in words ("a thousand a month", never "$1,000"), and keep it short. Start with just the two options in a sentence each: "We have two options. Contingency is fifteen percent of the first-year salary, and you only pay if you hire someone we send you. Or there's a monthly subscription that starts at a thousand a month for one search, with no placement fees." Then stop and let them react. Only if they ask for the subscription tiers, give them one at a time, slowly, exactly as written here: "One search at a time is a thousand a month. Up to three searches is two thousand a month. Up to five is three thousand a month. And six or more, Justin puts together a custom price." Don't add up, compare or estimate costs for them (for example what fifteen percent of a salary comes to); say Justin can walk through the numbers for their positions. Pricing is also on the website under Pricing, so you can point them there.
  - Full fee, payment and subscription terms are in the written agreement; Justin goes over that with them.
- They don't need everything figured out before reaching out: the position, where it's located and what they need from the person is enough to start. If they have a job description, they can email it.
- Website: jpeacerecruiting.com (say "j peace recruiting dot com"). Email: justin@jpeacerecruiting.com (say "justin at j peace recruiting dot com"). Phone: (814) 845-4341, the number they called.

WHO'S CALLING:
${whoIsCalling(c)}

PUBLIC OPENINGS (the only jobs you may talk about):
${openings(c)}`;
}

export const RECEPTION_HANDOFF_REPLY =
  "Nothing needs to be looked up, noted or saved: the call is recorded and Justin gets the message afterward. Answer the caller right away and carry on.";

export async function receptionUpdate(
  db: Db,
  secret: string,
  id: string,
  p: Record<string, unknown>,
) {
  const { error } = await db.rpc("reception_update", {
    p_secret: secret,
    p_id: id,
    p: p as Json,
  });
  if (error) console.error("reception_update failed", id, error.message);
}

const NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    caller_kind: {
      type: "string",
      enum: [
        "job_seeker",
        "candidate",
        "employer_lead",
        "client",
        "sales_or_spam",
        "wrong_number",
        "other",
      ],
    },
    caller_name: { type: "string" },
    company: { type: "string" },
    callback_number: { type: "string" },
    email: { type: "string" },
    reason: { type: "string" },
    best_time: { type: "string" },
    summary: { type: "string" },
    priority: { type: "integer", enum: [1, 2, 3] },
    needs_callback: { type: "boolean" },
  },
  required: [
    "caller_kind",
    "caller_name",
    "company",
    "callback_number",
    "email",
    "reason",
    "best_time",
    "summary",
    "priority",
    "needs_callback",
  ],
};

async function writeUp(c: ReceptionContext, transcript: Line[]) {
  const said = transcript
    .map(
      (l) =>
        `[${l.speaker === "agent" ? "JPR assistant" : "Caller"}] ${l.text}`,
    )
    .join("\n");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      reasoning: { effort: "low" },
      instructions: `You turn a call to JPR's business line, answered by JPR's AI assistant, into a message for Justin Peace. Use only what was said on the call and the caller ID info. Never invent anything; leave a field "" when it didn't come up.
caller_kind: job_seeker (looking for work), candidate (someone we're already working with, returning a call or asking about their process), employer_lead (a business that wants help hiring and isn't a known client), client (a known client contact), sales_or_spam (sales, vendor, survey, robocall), wrong_number, or other.
caller_name and company as they gave them. callback_number: the number they want a call back on; if they agreed to the one they called from, use that. best_time: when they said is good to reach them, in their words.
reason: one short line on what they want. summary: 2-3 plain sentences for Justin covering who called, what they need and anything urgent.
priority: 1 for a client issue, a new employer lead, or anything they said is urgent; 2 for candidates and job seekers; 3 for sales and everything else.
needs_callback: false only for spam, robocalls, wrong numbers, or calls where nobody said anything useful.`,
      input: JSON.stringify({
        now_eastern: new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          dateStyle: "full",
          timeStyle: "short",
        }),
        caller_id: {
          number: c.from,
          candidate: c.candidate_name,
          client_contact: c.contact_name
            ? `${c.contact_name}${c.contact_company ? ` at ${c.contact_company}` : ""}`
            : null,
          is_justins_own_phone: c.owner,
        },
        transcript:
          said || "(no transcript: the recording was unavailable or empty)",
      }),
      text: {
        format: {
          type: "json_schema",
          name: "reception_notes",
          schema: NOTES_SCHEMA,
          strict: true,
        },
      },
    }),
  });
  if (!res.ok)
    throw new Error(
      `Write-up failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  const out = await res.json();
  const text = (out.output ?? [])
    .flatMap(
      (o: { content?: { type: string; text?: string }[] }) => o.content ?? [],
    )
    .find((x: { type: string }) => x.type === "output_text")?.text;
  return JSON.parse(text) as Record<string, unknown>;
}

// Each automation tick: write up one finished call (the recording takes a little while to be ready).
export async function processReception(db: Db, secret: string) {
  const { data } = await db.rpc("reception_to_process", { p_secret: secret });
  const c = data as unknown as ReceptionContext | null;
  if (!c) return false;
  try {
    const wav = c.live_session_id
      ? await callRecording(c.live_session_id)
      : null;
    if (!wav) {
      const waited = c.ended_at
        ? Date.now() - new Date(c.ended_at).getTime()
        : 0;
      if (waited < 15 * 60_000) {
        await receptionUpdate(db, secret, c.id, {
          process_state: "pending",
          process_note: "Waiting for the recording",
        });
        return false;
      }
    }
    const transcript = wav ? await transcribe(wav) : [];
    const notes = await writeUp(c, transcript);
    const { error } = await db.rpc("reception_complete", {
      p_secret: secret,
      p_id: c.id,
      p: { ...notes, transcript } as unknown as Json,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error("Reception write-up failed", c.id, e);
    await receptionUpdate(db, secret, c.id, {
      process_state: "failed",
      process_note: String(e).slice(0, 500),
    });
    return false;
  }
}

// Start (or continue) watching an answering-agent call: see /api/reception/watch.
export async function startReceptionWatch(
  origin: string,
  id: string,
  sessionId: string,
  callStartedAt: number,
  slice = 1,
) {
  const res = await fetch(
    webhookUrl(origin, `/api/reception/watch?id=${id}&sig=${receptionSig(id)}`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, callStartedAt, slice }),
    },
  ).catch((e) => e as Error);
  if (res instanceof Error || !res.ok) {
    console.error(
      "Couldn't start the reception watcher",
      id,
      res instanceof Error ? res.message : res.status,
    );
  }
}
