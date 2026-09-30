import { escapeXml, toE164, twilioNumber, webhookUrl } from "@/lib/twilio";
import { readTwilio, webhookDb } from "../webhook";

// Someone called JPR's number. Log it, then ring Justin's cell showing the business number, so he can
// tell work calls from spam; a short announcement says who it is. The AI receptionist replaces this in phase 6.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const secret = process.env.TWILIO_WEBHOOK_SECRET ?? "";
  const db = webhookDb();
  const [{ data }] = await Promise.all([
    db.rpc("twilio_forward_number", { p_secret: secret }),
    p.CallSid ? db.rpc("twilio_inbound_call", { p_secret: secret, p_sid: p.CallSid, p_from: p.From ?? "" }) : null,
  ]);
  const cell = toE164(data);
  const origin = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? origin.host;
  const whisper = new URL(webhookUrl(`https://${host}`, "/api/twilio/whisper"));
  whisper.searchParams.set("from", p.From ?? "");
  const twiml = cell
    ? `<Response><Dial callerId="${escapeXml(twilioNumber ?? p.To ?? "")}" timeout="25">` +
      `<Number url="${escapeXml(whisper.toString())}">${escapeXml(cell)}</Number></Dial>` +
      `<Say>Sorry we missed you. Please text this number and we will get right back to you.</Say></Response>`
    : `<Response><Say>Thanks for calling J P R. Please text this number and we will get right back to you.</Say></Response>`;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}
