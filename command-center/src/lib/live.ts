import { createHmac, timingSafeEqual } from "node:crypto";

// OpenAI GPT-Live, the voice agent on screening calls. Twilio dials the candidate and, once a person
// answers, bridges the call to OpenAI over SIP; OpenAI then asks our webhook how to run the call.
// Keys live in Vercel: OPENAI_API_KEY, OPENAI_PROJECT_ID (proj_...), OPENAI_WEBHOOK_SECRET (whsec_...).

const API = "https://api.openai.com/v1";

export const liveModel = () => process.env.OPENAI_LIVE_MODEL?.trim() || "gpt-live-1";
export const liveVoice = () => process.env.OPENAI_LIVE_VOICE?.trim() || "marin";

export function liveSetup() {
  return {
    key: Boolean(process.env.OPENAI_API_KEY?.trim()),
    project: Boolean(process.env.OPENAI_PROJECT_ID?.trim()),
    webhook: Boolean(process.env.OPENAI_WEBHOOK_SECRET?.trim()),
  };
}
export function liveReady() {
  const s = liveSetup();
  return s.key && s.project && s.webhook;
}

// Where Twilio sends the answered call. The run id rides along as a SIP header so the webhook knows
// which call it is; it's signed, because SIP headers are only as trustworthy as whoever sent them.
// secure=true makes Twilio encrypt the audio (SRTP), which GPT-Live requires.
export function sipUri(runId: string) {
  return `sip:${process.env.OPENAI_PROJECT_ID!.trim()}@sip.api.openai.com;transport=tls;secure=true?X-JPR-Run=${runId}.${runSig(runId)}`;
}

export function runSig(runId: string) {
  return createHmac("sha256", process.env.TWILIO_WEBHOOK_SECRET ?? "").update(`screening-run:${runId}`).digest("hex").slice(0, 32);
}
export function validRunSig(runId: string, sig: string | null | undefined) {
  if (!sig) return false;
  const a = Buffer.from(runSig(runId));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

// "X-JPR-Run: <run>.<sig>" out of the webhook's SIP headers, if it's there and signed right.
export function runFromSipHeaders(headers: unknown): string | null {
  const list: { name?: string; value?: string }[] = Array.isArray(headers)
    ? headers
    : headers && typeof headers === "object"
      ? Object.entries(headers as Record<string, string>).map(([name, value]) => ({ name, value }))
      : [];
  for (const h of list) {
    if (h.name?.toLowerCase() !== "x-jpr-run" || !h.value) continue;
    const [run, sig] = h.value.trim().split(".");
    if (run && validRunSig(run, sig)) return run;
  }
  return null;
}

// Standard Webhooks signature check (what OpenAI uses): HMAC-SHA256 over "id.timestamp.body" with the
// base64 secret after "whsec_", compared against each "v1,<sig>" in the header. Five-minute window.
export function validOpenAIWebhook(body: string, headers: Headers) {
  // Tolerate stray quotes or spaces from pasting the secret into Vercel.
  const secret = process.env.OPENAI_WEBHOOK_SECRET?.trim().replace(/^["']|["']$/g, "").trim();
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigs = headers.get("webhook-signature");
  const fail = (why: string) => {
    // Never logs the secret itself, only its shape, so a bad paste can be spotted.
    console.warn("OpenAI webhook rejected:", why, {
      secretLength: secret?.length ?? 0,
      secretHasPrefix: secret?.startsWith("whsec_") ?? false,
      hasId: Boolean(id),
      hasTimestamp: Boolean(ts),
      signatureShape: sigs?.split(" ").map((p) => p.split(",")[0]).join(" ") ?? null,
    });
    return false;
  };
  if (!secret || !id || !ts || !sigs) return fail("missing secret or header");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return fail("timestamp outside 5 minutes");
  const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64"));
  const ok = sigs.split(" ").some((part) => {
    const sig = Buffer.from(part.startsWith("v1,") ? part.slice(3) : part);
    return sig.length === expected.length && timingSafeEqual(sig, expected);
  });
  return ok || fail("signature mismatch");
}

async function openai(path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status} on ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

export type CallContext = {
  run_id: string;
  candidate_job_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  sms_opted_out: boolean;
  current_title: string | null;
  current_employer: string | null;
  city: string | null;
  state: string | null;
  candidate_notes: string | null;
  resume: string | null;
  job_title: string;
  location: string | null;
  compensation: string | null;
  schedule: string | null;
  job_description: string | null;
  company: string;
  hiring_contact: string | null;
  goals: { id: string; question: string; required: boolean }[];
  history: { at: string; kind: string; direction: string | null; text: string | null }[];
  call_sid: string | null;
  live_session_id: string | null;
  stage: string;
  status: string;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0];

// The voice agent's brief.
export function callInstructions(c: CallContext) {
  const questions = c.goals.length
    ? c.goals.map((g, i) => `${i + 1}. ${g.question}${g.required ? " (must cover)" : ""}`).join("\n")
    : "1. Pay expectations and whether this job's pay works\n2. Commute and whether the location works\n3. Availability: when they could start and schedule fit\n4. Interest in this role and why they'd move";
  const facts = [
    `Job: ${c.job_title}`,
    `Company: ${c.company}`,
    c.location && `Location: ${c.location}`,
    c.compensation && `Pay: ${c.compensation}`,
    c.schedule && `Schedule: ${c.schedule}`,
  ]
    .filter(Boolean)
    .join("\n");
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
  return `You are the screening assistant for JPR, a recruiting firm in Punxsutawney, PA. You work for Justin, who owns it. You are on a phone call with ${c.full_name}, who agreed to a short call about the ${c.job_title} job. It is ${now} Eastern.

YOUR GOAL: a friendly, quick 5 to 10 minute screening call that gets Justin what he needs to submit this person to the employer, and answers their questions about the job.

OPENING (always, in this order, before anything else). You speak first: the moment the call connects, start without waiting for them to say hello.
1. "Hi, is this ${firstName(c.full_name)}?" If it's someone else, ask politely when ${firstName(c.full_name)} is available, then say goodbye (outcome wrong_person).
2. Then, in one breath: "This is JPR's AI assistant, calling for Justin about the ${c.job_title} job. Heads up, the call is recorded so Justin gets good notes. Is that okay?" Get a clear yes before going on. If they say no, say no problem, Justin will give them a call himself, and say goodbye (outcome declined_recording).
3. "Is now still a good time? It'll take about five minutes." If not, ask when is better (day and time), confirm it, and say goodbye (outcome callback, with the time in the note).

THE QUESTIONS to cover, in a natural order, one at a time:
${questions}
Also find out, if it hasn't come up: what they're doing now, the experience that matches this job (machines, tools, software, certifications, years), what they make now and want, when they could interview, and anything the employer should know up front. Ask a follow-up when an answer is vague ("about how many years?", "which machines?"). Don't re-ask what they already told you.

JOB FACTS you may share (never invent anything beyond these; if they ask something not covered, say Justin will get them that answer):
${facts}
${c.job_description ? `About the job: ${c.job_description.slice(0, 2500)}` : ""}
Share the company name if they ask or once they're interested.

WHAT WE ALREADY KNOW about them (use it to sound prepared, don't read it back):
${[c.current_title && `Current title: ${c.current_title}`, c.current_employer && `Current employer: ${c.current_employer}`, (c.city || c.state) && `Lives in: ${[c.city, c.state].filter(Boolean).join(", ")}`].filter(Boolean).join("\n") || "Not much yet."}
${c.resume ? `Resume (excerpt): ${c.resume.slice(0, 2500)}` : ""}

HOW TO TALK:
- Friendly but quick, like a good local recruiter on a busy day. Short, plain sentences. Let them talk.
- Ask ONE question, then stop and wait for their answer. Never answer your own question, guess their answer, or stack two questions together.
- Don't open replies with filler like "Great", "Perfect", "Awesome", "Okay, good" or "Got it". Most of the time, go straight to the next question. A short, varied acknowledgment is fine now and then when it sounds natural.
- Call him "Justin", never "Justin Peace".
- You never pause to take notes or look anything up: the whole call is recorded and Justin gets the notes afterward. Never say "let me note that", "let me mark that", "one moment" or "let me check". Always answer right away and keep the conversation moving.
- Never promise an interview, an offer or a specific pay. Never pressure. If they ask whether you're a real person, say honestly that you're an AI assistant working for Justin.

SENSITIVE THINGS: if they bring up something personal, such as a criminal record, a health issue, a gap in work or being let go, stay calm and neutral. Thank them for being upfront, say Justin will keep it in mind when he talks with the employer, and move on to the next question. Don't judge it, don't guess how the employer will see it, and don't dig for details. Never ask about health, disability, age, religion, pregnancy or family plans.

SAFETY: if they're upset, inappropriate, abusive, or ask to stop, stay polite, say Justin will follow up, and say goodbye. If they ask to never be called again, say you'll make sure of it and say goodbye (outcome not_interested, note "do not call").

WRAP-UP: when the questions are covered, ask "Any questions for me about the job?" and answer what you can. Then say Justin will look everything over and reach out about next steps with the employer.

ENDING THE CALL: finish with "Thanks, ${firstName(c.full_name)}. Take care, bye." The call hangs up on its own a few seconds later. After your goodbye, say nothing more unless they speak again.`;
}


// Accept the bridged call with this run's brief. The Trigger.dev call watcher (src/trigger/call-watch.ts)
// stays on the call over the sideband and hangs up once it's over.
// Accept once: a rejected accept ends OpenAI's side of the call, so there's no second try.
export async function acceptCall(sessionId: string, c: CallContext) {
  return openai(`/live/sessions/${sessionId}/accept`, {
    session: {
      type: "live",
      model: liveModel(),
      instructions: callInstructions(c),
      audio: { output: { voice: liveVoice() } },
      store: true,
    },
  });
}

// GPT-Live waits for the other person to speak first; on a call we place, the assistant should open.
// Attach over the sideband for a moment and tell it to greet now. Best effort: a failure only means
// it waits for "hello" like before.
export async function startGreeting(sessionId: string, firstName: string) {
  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(`wss://api.openai.com/v1/live/sessions/${sessionId}/attach`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
  });
  const content = `The call just connected and they've picked up. Start now with your opening: "Hi, is this ${firstName}?" Then stop and listen.`;
  return new Promise<string>((resolve) => {
    let sent = false;
    const finish = (result: string) => {
      clearTimeout(giveUp);
      ws.close();
      resolve(result);
    };
    const send = () => {
      if (sent || ws.readyState !== WebSocket.OPEN) return;
      sent = true;
      ws.send(JSON.stringify({ type: "session.instructions.append", event_id: "greeting", delegation_id: null, content }));
    };
    const giveUp = setTimeout(() => finish(sent ? "sent, no ack" : "timed out"), 6000);
    ws.on("open", () => setTimeout(send, 800)); // give session.started a moment to arrive first
    ws.on("message", (raw) => {
      let e: { type?: string };
      try {
        e = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (e.type === "session.started") send();
      else if (e.type === "session.instructions.appended") finish("ok");
      else if (e.type === "error") finish(`error ${raw.toString().slice(0, 300)}`);
    });
    ws.on("error", (err) => finish(`socket ${String(err).slice(0, 200)}`));
  });
}

export async function rejectCall(sessionId: string) {
  return openai(`/live/sessions/${sessionId}/reject`, { status_code: 603 }).catch(() => null);
}

export async function hangupCall(sessionId: string) {
  return openai(`/live/sessions/${sessionId}/hangup`, {});
}

// The stored call recording: stereo WAV, candidate on the left channel, the assistant on the right.
// null while it isn't ready yet.
export async function callRecording(sessionId: string): Promise<Buffer | null> {
  const res = await fetch(`${API}/live/sessions/${sessionId}/content`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 409 || res.status === 425) return null;
  if (!res.ok) throw new Error(`OpenAI ${res.status} on recording: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}
