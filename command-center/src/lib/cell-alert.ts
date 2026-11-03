import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { escapeXml, toE164, twilioApi, twilioNumber } from "@/lib/twilio";

// Passes a message or voicemail someone left on JPR's line on to Justin's cell (Justin 2026-11-03:
// "leave me a voice mail to my personal number anytime someone leaves a voice mail or leaves a message
// with the agent for any reason (non candidate related)"). During ring hours his cell rings and the
// message is read out: to him if he answers, onto his cell's voicemail if he doesn't. Overnight it comes
// as a text instead, so his phone never rings at 4am.

type Db = SupabaseClient<Database>;

// Hours (Eastern) JPR may ring Justin's cell, the same window business calls ring it.
export const RING_FROM = 8;
export const RING_UNTIL = 21;

export function ringHours() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "America/New_York",
    }).format(new Date()),
  );
  return hour >= RING_FROM && hour < RING_UNTIL;
}

const digitsOf = (n: string | null | undefined) =>
  (n ?? "").replace(/\D/g, "").slice(-10);

function prettyNumber(n: string | null | undefined) {
  const d = digitsOf(n);
  return d.length === 10
    ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    : n || "an unknown number";
}

// "8 1 4, 8 4 5, 4 3 4 1" so a phone number is read out digit by digit.
function spokenNumber(n: string | null | undefined) {
  const d = digitsOf(n);
  if (d.length !== 10) return "a number I didn't catch";
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)]
    .map((g) => g.split("").join(" "))
    .join(", ");
}

export type CellAlert = {
  kind: "voicemail" | "message";
  who: string | null;
  company?: string | null;
  number: string | null;
  text: string;
};

export async function alertJustin(db: Db, a: CellAlert) {
  const { data } = await db.rpc("twilio_forward_number", {
    p_secret: process.env.TWILIO_WEBHOOK_SECRET ?? "",
  });
  const cell = toE164(data);
  if (!cell || !twilioNumber) return "no cell";
  const who = [a.who, a.company].filter(Boolean).join(" from ") || "Someone";
  const text = a.text.replace(/\s+/g, " ").trim().slice(0, 900);

  if (!ringHours()) {
    await twilioApi("Messages", {
      From: twilioNumber,
      To: cell,
      Body: `JPR ${a.kind === "voicemail" ? "voicemail" : "message"} from ${who}, ${prettyNumber(a.number)}: ${text || "(no words)"}`.slice(
        0,
        1200,
      ),
    });
    return "texted";
  }
  const what =
    a.kind === "voicemail"
      ? `${who} left a voicemail on the JPR line.`
      : `${who} called the JPR line and left a message with me.`;
  const say = (s: string) => `<Say>${escapeXml(s)}</Say>`;
  // DetectMessageEnd: if his voicemail picks up, Twilio waits for the beep before reading it out.
  await twilioApi("Calls", {
    From: twilioNumber,
    To: cell,
    MachineDetection: "DetectMessageEnd",
    Timeout: "30",
    Twiml:
      `<Response><Pause length="1"/>` +
      say(`Hi Justin, it's your JPR assistant. ${what}`) +
      say(`Their number is ${spokenNumber(a.number)}.`) +
      (text ? say(a.kind === "voicemail" ? `Here's what they said. ${text}` : text) : "") +
      say(
        `Again, that number is ${spokenNumber(a.number)}. It's also on What needs me. Bye.`,
      ) +
      `</Response>`,
  });
  return "called";
}

// A plain voicemail has no write-up, so: is it from a job seeker, or junk? (Those don't ring Justin.)
export async function voicemailIsForJustin(transcript: string) {
  if (!process.env.OPENAI_API_KEY) return true;
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
        reasoning: { effort: "low" },
        instructions:
          "A voicemail left on JPR's line (a recruiting firm). Classify who left it. job_seeker: someone looking for work, applying, or a candidate returning a call about a job. junk: robocalls, recordings, sales pitches, surveys, silence or noise. other: everyone else (employers, clients, vendors with a real question, personal calls).",
        input: transcript.slice(0, 4000),
        text: {
          format: {
            type: "json_schema",
            name: "voicemail_kind",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { kind: { type: "string", enum: ["job_seeker", "junk", "other"] } },
              required: ["kind"],
            },
          },
        },
      }),
    });
    if (!res.ok) return true;
    const out = await res.json();
    const t = (out.output ?? [])
      .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
      .find((x: { type: string }) => x.type === "output_text")?.text;
    return JSON.parse(t).kind === "other";
  } catch {
    return true;
  }
}
