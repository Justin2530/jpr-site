import { automationSecret } from "@/lib/automation";
import { validRunSig } from "@/lib/live";
import { twilioApi } from "@/lib/twilio";
import { update, voicemailTwiml } from "@/lib/screening";
import { EMPTY_TWIML, readTwilio, webhookDb } from "@/app/api/twilio/webhook";

// Twilio's answering-machine check, which runs while the call is already connected to the assistant.
// A voicemail greeting gets the call switched over to a short message; a person changes nothing.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const answeredBy = p.AnsweredBy ?? "unknown";
  if (!/^machine|^fax/.test(answeredBy) || !p.CallSid) return EMPTY_TWIML.clone();

  const db = webhookDb();
  const secret = automationSecret()!;
  await update(db, secret, run, { answered_by: answeredBy });
  try {
    await twilioApi(`Calls/${p.CallSid}`, { Twiml: `<Response>${await voicemailTwiml(db, secret, run)}</Response>` });
  } catch (e) {
    console.error("Couldn't switch the call to the voicemail message", run, e);
  }
  return EMPTY_TWIML.clone();
}
