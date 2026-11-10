import { after } from "next/server";
import { readTwilio, webhookDb } from "../webhook";

const HANGUP = () => new Response("<Response><Hangup/></Response>", { headers: { "Content-Type": "text/xml" } });

async function transcribe(recordingUrl: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const audio = await fetch(`${recordingUrl}.mp3`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
  });
  if (!audio.ok) throw new Error(`Recording download failed (${audio.status})`);
  const form = new FormData();
  form.append("file", new Blob([await audio.arrayBuffer()], { type: "audio/mpeg" }), "voicemail.mp3");
  form.append("model", "whisper-1");
  form.append("language", "en");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()).text as string) ?? "";
}

// JPR's voicemail. Twilio posts here twice: as the <Record> action (we just hang up) and once the recording
// is ready (recordingStatusCallback), when we transcribe it onto the call and add it to What needs me.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  if (p.RecordingStatus !== "completed" || !p.RecordingUrl || !p.CallSid) return HANGUP();
  const { CallSid: sid, RecordingUrl: recording } = p;
  const seconds = Number(p.RecordingDuration ?? 0);
  after(async () => {
    let text = "";
    try {
      if (seconds >= 2) text = await transcribe(recording);
    } catch (e) {
      console.error("voicemail transcription", e);
      text = "(Left a voicemail, but it couldn't be transcribed. It's in the Twilio call log.)";
    }
    const { error } = await webhookDb().rpc("twilio_voicemail", {
      p_secret: process.env.TWILIO_WEBHOOK_SECRET ?? "",
      p_sid: sid,
      p_seconds: seconds,
      p_text: text,
    });
    if (error) console.error("twilio voicemail", error.message);
  });
  return HANGUP();
}
