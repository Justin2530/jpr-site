import { escapeXml, toE164, twilioNumber, webhookUrl } from "@/lib/twilio";
import { readTwilio, webhookDb } from "../webhook";

// Hours (Eastern) a call to JPR's number rings Justin's cell, the same window our texts keep.
const RING_FROM = 8;
const RING_UNTIL = 21;

function ringHours() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(new Date()),
  );
  return hour >= RING_FROM && hour < RING_UNTIL;
}

// Our own voicemail, so callers never land in Justin's personal one. The recording is transcribed into the Command Center.
function voicemail(origin: string, greeting: string) {
  const done = escapeXml(webhookUrl(origin, "/api/twilio/voicemail"));
  return (
    `<Say>${greeting}</Say>` +
    `<Record maxLength="120" timeout="5" playBeep="true" trim="trim-silence" action="${done}" recordingStatusCallback="${done}" recordingStatusCallbackEvent="completed"/>` +
    `<Hangup/>`
  );
}

const twiml = (body: string) => new Response(`<Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });

// Someone called JPR's number. Log it, then (during ring hours) ring Justin's cell showing the business number,
// with a short announcement and "press 1" so his cell's voicemail can never take the call. Anything he doesn't
// take goes to JPR's voicemail. The AI receptionist replaces this in phase 6.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  const missed = "Sorry we missed you. Please leave a message for J P R after the tone, or text this number.";

  // The forwarded call ended: hang up if Justin talked to them, otherwise take a message.
  if (url.searchParams.get("step") === "after") {
    return twiml(p.DialBridged === "true" ? "<Hangup/>" : voicemail(origin, missed));
  }

  const secret = process.env.TWILIO_WEBHOOK_SECRET ?? "";
  const db = webhookDb();
  const [{ data }] = await Promise.all([
    db.rpc("twilio_forward_number", { p_secret: secret }),
    p.CallSid ? db.rpc("twilio_inbound_call", { p_secret: secret, p_sid: p.CallSid, p_from: p.From ?? "" }) : null,
  ]);
  const cell = toE164(data);
  if (!cell || !ringHours()) {
    return twiml(
      voicemail(
        origin,
        "Thanks for calling J P R. Please leave a message after the tone, or text this number, and we will get right back to you.",
      ),
    );
  }
  const whisper = new URL(webhookUrl(origin, "/api/twilio/whisper"));
  whisper.searchParams.set("from", p.From ?? "");
  const after = webhookUrl(origin, "/api/twilio/voice?step=after");
  return twiml(
    `<Dial callerId="${escapeXml(twilioNumber ?? p.To ?? "")}" timeout="25" action="${escapeXml(after)}">` +
      `<Number url="${escapeXml(whisper.toString())}">${escapeXml(cell)}</Number></Dial>`,
  );
}
