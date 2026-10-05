import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { toE164, twilioApi, twilioNumber, twilioReady, webhookUrl } from "@/lib/twilio";
import { callRecording, liveReady, runSig, type CallContext } from "@/lib/live";
import { SIGNATURE, SUBMISSION_STYLE } from "@/lib/submission";

// The screening-call engine: dial calls whose time has come, text people we missed, and turn finished
// calls into notes, answers and a submission draft. Runs on every automation tick.

type Db = SupabaseClient<Database>;
const first = (name: string) => name.trim().split(/\s+/)[0];

export async function runScreening(db: Db, secret: string, origin: string) {
  const out = { dialed: 0, processed: 0 };
  if (!liveReady() || !twilioReady()) return out;
  const { data: due } = await db.rpc("screening_due", { p_secret: secret });
  for (const c of (due ?? []) as unknown as CallContext[]) {
    try {
      await dial(db, secret, origin, c);
      out.dialed++;
    } catch (e) {
      console.error("Screening dial failed", c.run_id, e);
      await update(db, secret, c.run_id, { status: "failed", process_note: e instanceof Error ? e.message.slice(0, 300) : "dial failed", ended: true });
    }
  }
  try {
    if (await processOne(db, secret)) out.processed++;
  } catch (e) {
    console.error("Screening notes failed", e);
  }
  return out;
}

export function update(db: Db, secret: string, run: string, p: Record<string, unknown>) {
  return db.rpc("screening_update", { p_secret: secret, p_run: run, p: p as Json });
}

async function dial(db: Db, secret: string, origin: string, c: CallContext) {
  const to = toE164(c.phone);
  if (!to) {
    await update(db, secret, c.run_id, { status: "failed", process_note: "No phone number on file", ended: true });
    return;
  }
  const q = `run=${c.run_id}&sig=${runSig(c.run_id)}`;
  const call = await twilioApi("Calls", {
    To: to,
    From: twilioNumber!,
    Url: webhookUrl(origin, `/api/screening/answer?${q}`),
    StatusCallback: webhookUrl(origin, `/api/screening/status?${q}`),
    MachineDetection: "Enable",
    Timeout: "30",
  });
  await update(db, secret, c.run_id, { call_sid: call.sid });
}

// Voicemail, no answer, busy: one friendly text asking for a better time. The reply brain books it.
export async function missedCall(db: Db, secret: string, run: string, why: string) {
  const { data } = await db.rpc("screening_get", { p_secret: secret, p_run: run });
  const c = data as unknown as CallContext | null;
  const p: Record<string, unknown> = { status: "no_answer", outcome_note: why, ended: true };
  const to = toE164(c?.phone);
  if (c && to && !c.sms_opted_out && twilioReady()) {
    const body = `Hi ${first(c.full_name)}, it's JPR. I tried calling for our call about the ${c.job_title} position but missed you. What's a better day and time to reach you?`;
    try {
      const msg = await twilioApi("Messages", { To: to, From: twilioNumber!, Body: body });
      p.log_text = { body, sid: msg.sid, phone: to };
    } catch (e) {
      console.error("Missed-call text failed", run, e);
    }
  }
  await update(db, secret, run, p);
}

// ---------- After the call ----------

type Segment = { start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number };
type Word = { word: string; start: number; end: number };
type Line = { speaker: "agent" | "candidate"; text: string; at: number };

async function processOne(db: Db, secret: string) {
  const { data } = await db.rpc("screening_to_process", { p_secret: secret });
  const c = data as unknown as (CallContext & { ended_at?: string }) | null;
  if (!c) return false;
  const run = c.run_id;
  try {
    const wav = c.live_session_id ? await callRecording(c.live_session_id) : null;
    if (!wav) {
      // The recording can take a little while to be ready. Give it 15 minutes, then file what we have.
      const waited = c.ended_at ? Date.now() - new Date(c.ended_at).getTime() : 0;
      if (waited < 15 * 60_000) {
        await update(db, secret, run, { process_state: "pending", process_note: "Waiting for the recording" });
        return false;
      }
    }
    const transcript = wav ? await transcribe(wav) : [];
    const notes = await writeUp(c, transcript);
    const { error } = await db.rpc("screening_complete", {
      p_secret: secret,
      p_run: run,
      p: { ...notes, transcript } as unknown as Json,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error("Screening write-up failed", run, e);
    await update(db, secret, run, { process_state: "failed", process_note: e instanceof Error ? e.message.slice(0, 300) : "write-up failed" });
    return false;
  }
}

// Split the stereo recording into the two speakers, shrink each to phone quality (8 kHz mono) so it
// fits the transcription limit, and transcribe both with timestamps.
async function transcribe(wav: Buffer): Promise<Line[]> {
  const audio = readWav(wav);
  const channels = audio.channels.length === 2 ? audio.channels : [audio.channels[0]];
  const speakers: Line["speaker"][] = channels.length === 2 ? ["candidate", "agent"] : ["candidate"];
  const pcm = channels.map((ch) => downsample(ch, audio.rate, 8000));
  const parts = await Promise.all(pcm.map((x) => whisper(toWav(x, 8000))));
  const lines: Line[] = [];
  parts.forEach(({ segments, words }, i) => {
    const onset = speechOnset(pcm[i], 8000);
    let prevEnd = 0;
    for (const s of segments) {
      const text = s.text.trim();
      if (!text || (s.no_speech_prob ?? 0) > 0.6) continue;
      // A segment's own start time is rough (often snapped to the previous segment's end), which put
      // replies ahead of the questions they answered. The first word's time is where speech starts.
      const first = words.find((w) => w.start >= s.start - 0.05 && w.start < s.end);
      lines.push({ speaker: speakers[i], text, at: Math.round(onset(first?.start ?? s.start, prevEnd) * 10) / 10 });
      prevEnd = s.end;
    }
  });
  // Same instant: the assistant's line goes first, since it opens and the candidate answers.
  return lines.sort((a, b) => a.at - b.at || (a.speaker === "agent" ? -1 : 1));
}

// The transcriber's times can be off by a second or two. Each speaker has their own channel, so the
// moment their voice actually starts is where the sound gets loud near that time: the first 20 ms frame
// well above the channel's background level, searched from 1.5 s before (but not back into their
// previous line) to 1.5 s after.
export function speechOnset(x: Float32Array, rate: number) {
  const frame = Math.round(rate * 0.02);
  const rms = new Float32Array(Math.floor(x.length / frame));
  for (let f = 0; f < rms.length; f++) {
    let sum = 0;
    for (let j = f * frame; j < (f + 1) * frame; j++) sum += x[j] * x[j];
    rms[f] = Math.sqrt(sum / frame);
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const loud = Math.max(0.02, floor * 4);
  return (t: number, notBefore = 0) => {
    const from = Math.max(0, Math.floor(Math.max(t - 1.5, notBefore) / 0.02));
    const to = Math.min(rms.length, Math.ceil((t + 1.5) / 0.02));
    for (let f = from; f < to; f++) if (rms[f] > loud) return (f * frame) / rate;
    return t;
  };
}

export function readWav(buf: Buffer) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Recording isn't a WAV file");
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    if (id === "data" && (size === 0 || size === 0xffffffff || pos + 8 + size > buf.length)) size = buf.length - pos - 8;
    if (id === "fmt ") {
      fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    } else if (id === "data") {
      data = buf.subarray(pos + 8, pos + 8 + size);
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("Recording is missing audio");
  if (fmt.bits !== 16) throw new Error(`Recording is ${fmt.bits}-bit audio; expected 16-bit`);
  const frames = Math.floor(data.length / (2 * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++)
    for (let ch = 0; ch < fmt.channels; ch++) channels[ch][f] = data.readInt16LE((f * fmt.channels + ch) * 2) / 32768;
  return { rate: fmt.rate, channels };
}

export function downsample(x: Float32Array, from: number, to: number) {
  if (from <= to) return x;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(x.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(x.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += x[j];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

export function toWav(x: Float32Array, rate: number) {
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + x.length * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return buf;
}

async function whisper(wav: Buffer): Promise<{ segments: Segment[]; words: Word[] }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "call.wav");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("timestamp_granularities[]", "word");
  form.append("language", "en");
  // Spelling hints for shop-floor words the transcriber otherwise mangles ("Mazak" came out "Mays Act").
  form.append(
    "prompt",
    "JPR recruiting screening call, Punxsutawney PA. Mazak, Haas, Okuma, Fanuc, Doosan, Hurco, Brother, CNC, VMC, HMC, Swiss lathe, G-code, M-code, Mastercam, ESPRIT, CMM, Keyence, MIG, TIG, forklift, OSHA, first shift, second shift, third shift.",
  );
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  return { segments: (out.segments ?? []) as Segment[], words: (out.words ?? []) as Word[] };
}

const NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    outcome: { type: "string", enum: ["interested", "not_interested", "callback", "incomplete"] },
    callback_at_local: { type: "string" },
    summary: { type: "string" },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { goal_id: { type: "string" }, label: { type: "string" }, value: { type: "string" } },
        required: ["goal_id", "label", "value"],
      },
    },
    candidate_questions: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    unresolved: { type: "array", items: { type: "string" } },
    submission_subject: { type: "string" },
    submission_body: { type: "string" },
  },
  required: [
    "outcome",
    "callback_at_local",
    "summary",
    "facts",
    "candidate_questions",
    "concerns",
    "unresolved",
    "submission_subject",
    "submission_body",
  ],
};

// One pass over the transcript: what they said against each screening question, what to watch for,
// and (when they're interested) the submission email in Justin's style.
async function writeUp(c: CallContext, transcript: Line[]) {
  const said = transcript.map((l) => `[${l.speaker === "agent" ? "JPR assistant" : first(c.full_name)}] ${l.text}`).join("\n");
  const input = {
    now_eastern: new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }),
    candidate: { name: c.full_name, current_title: c.current_title, current_employer: c.current_employer, city: c.city, state: c.state },
    resume_excerpt: c.resume?.slice(0, 6000) ?? null,
    job: { title: c.job_title, company: c.company, location: c.location, pay: c.compensation, schedule: c.schedule },
    hiring_contact_first_name: c.hiring_contact ? first(c.hiring_contact) : null,
    screening_questions: c.goals,
    transcript: said || "(no transcript: the recording was unavailable or empty)",
  };
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      reasoning: { effort: "medium" },
      instructions: `You turn a recorded recruiting screening call into notes for Justin Peace (JPR). Use only what was actually said on the call and what the resume shows. Never invent anything.
outcome: interested (they want to move forward), not_interested, callback (they asked to talk at another time; put it in callback_at_local as "YYYY-MM-DD HH:MM" Eastern, else ""), or incomplete (call cut short, declined recording, wrong person, or too little was covered).
summary: 2-4 plain sentences for Justin: who they are, fit for the job, pay and availability, and anything to watch.
facts: one entry per screening question that got an answer, with goal_id set to that question's id and label a short name (e.g. "Pay", "Commute", "Availability"); value is their answer in a short plain sentence. Add extra entries with goal_id "" for other useful facts (current pay, interview availability, start date, certifications, machines). Skip questions that weren't answered.
candidate_questions: questions they asked that Justin should follow up on. concerns: anything that could be a problem for the employer. unresolved: required questions not covered.
submission_subject and submission_body: only when outcome is interested, otherwise "". Follow this style guide exactly, greeting the hiring contact by first name (or "[name]" if unknown), and end the body with "Thanks!" (the signature is added after):
${SUBMISSION_STYLE}`,
      input: JSON.stringify(input),
      text: { format: { type: "json_schema", name: "screening_notes", schema: NOTES_SCHEMA, strict: true } },
    }),
  });
  if (!res.ok) throw new Error(`Notes failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.output ?? [])
    .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
    .find((x: { type: string }) => x.type === "output_text")?.text;
  const n = JSON.parse(text);
  const body = n.submission_body?.trim();
  return {
    outcome: n.outcome,
    callback_at_local: n.callback_at_local,
    summary: n.summary,
    facts: n.facts,
    candidate_questions: n.candidate_questions,
    concerns: n.concerns,
    unresolved: n.unresolved,
    submission: body ? { subject: n.submission_subject, body: `${body}\n\n${SIGNATURE}` } : null,
  };
}
