import { createHmac, timingSafeEqual } from "node:crypto";
import { sipUriWith } from "@/lib/live";
import { webhookUrl } from "@/lib/twilio";

// Jarvis on the phone: Justin calls the main line from his cell and is put straight through to Jarvis's voice
// (GPT-Live over SIP, like the answering agent). The voice does the talking; every question or request is
// handed off to the Jarvis brain (lib/jarvis.ts) by the call watcher, which answers the hand-off.

export function jarvisSig(id: string) {
  return createHmac("sha256", process.env.TWILIO_WEBHOOK_SECRET ?? "")
    .update(`jarvis-call:${id}`)
    .digest("hex")
    .slice(0, 32);
}
export function validJarvisSig(id: string, sig: string | null | undefined) {
  if (!sig) return false;
  const a = Buffer.from(jarvisSig(id));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const jarvisSipUri = (id: string) => sipUriWith("X-JPR-Jarvis", `${id}.${jarvisSig(id)}`);

export function jarvisFromSipHeaders(headers: unknown): string | null {
  const list: { name?: string; value?: string }[] = Array.isArray(headers)
    ? headers
    : headers && typeof headers === "object"
      ? Object.entries(headers as Record<string, string>).map(([name, value]) => ({ name, value }))
      : [];
  for (const h of list) {
    if (h.name?.toLowerCase() !== "x-jpr-jarvis" || !h.value) continue;
    const [id, sig] = h.value.trim().split(".");
    if (id && validJarvisSig(id, sig)) return id;
  }
  return null;
}

export const JARVIS_GREETING =
  'J. P. is on the line now. Greet him right away, short and easy: "Hey J. P., Jarvis here. What do you need?"';

export function jarvisVoiceInstructions() {
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
  return `You are Jarvis, the chief of staff for Justin Peace, who owns JPR (J. Peace Recruiting) in Punxsutawney, PA. You call him "J. P.". He has called you on the business line from his own cell. It is ${now} Eastern.

You are the voice. Your back office has his whole business at hand: every client, job, candidate, text, email, call, the AI agents, the pipeline, and the ability to text, email and change things for him. You yourself don't know any facts about his business, so never answer a business question from memory and never make anything up.

HOW EVERY TURN GOES:
- When J. P. asks anything about his business, or asks you to do anything, say a very short "One sec." (or "Checking.") and hand it off to your back office right away. Then say what comes back, naturally, in your own voice.
- When the back office says to ask him to confirm, ask exactly that and wait. When he answers (confirm, yes, cancel, or a change), hand that off too: the back office does the action, you never do it yourself and never say it's done until the back office says so.
- Small talk, "thanks", "that's all": answer yourself, briefly.

HOW TO TALK: like a sharp, relaxed chief of staff. Short spoken sentences. Lead with the answer. No lists, no reading out ids, links or long numbers unless he asks. If he interrupts, stop and listen.

WHEN HE'S DONE: "You got it, J. P. Talk soon." Then stop talking; the call hangs up on its own.`;
}

export async function startJarvisWatch(origin: string, id: string, sessionId: string, callStartedAt: number, slice = 1) {
  const res = await fetch(webhookUrl(origin, `/api/jarvis/watch?id=${id}&sig=${jarvisSig(id)}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, callStartedAt, slice }),
  }).catch((e) => e as Error);
  if (res instanceof Error || !res.ok) console.error("Couldn't start the Jarvis call watcher", id, res instanceof Error ? res.message : res.status);
}
