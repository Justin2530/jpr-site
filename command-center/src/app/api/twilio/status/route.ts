import { EMPTY_TWIML, readTwilio, webhookDb } from "../webhook";

// Delivery updates for texts and the outcome and length of calls.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const sid = p.MessageSid ?? p.CallSid;
  const status = p.MessageStatus ?? p.CallStatus;
  if (!sid || !status) return EMPTY_TWIML.clone();
  const { error } = await webhookDb().rpc("twilio_status", {
    p_secret: process.env.TWILIO_WEBHOOK_SECRET ?? "",
    p_sid: sid,
    p_status: status,
    p_duration: p.CallDuration ? Number(p.CallDuration) : null,
  });
  if (error) {
    console.error("twilio status webhook", error.message);
    return new Response("Error", { status: 500 });
  }
  return EMPTY_TWIML.clone();
}
