import { escapeXml } from "@/lib/twilio";
import { automationSecret } from "@/lib/automation";
import { sipUri, validRunSig } from "@/lib/live";
import { update, voicemailTwiml } from "@/lib/screening";
import { readTwilio, webhookDb } from "@/app/api/twilio/webhook";

const twiml = (xml: string) => new Response(`<Response>${xml}</Response>`, { headers: { "Content-Type": "text/xml" } });

// The candidate's phone was answered: hand them straight to the AI assistant. Answering machines are
// caught by /api/screening/amd while this runs.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const db = webhookDb();
  const secret = automationSecret()!;
  const answeredBy = p.AnsweredBy ?? "unknown";

  if (/^machine|^fax/.test(answeredBy)) {
    await update(db, secret, run, { answered_by: answeredBy });
    return twiml(await voicemailTwiml(db, secret, run));
  }

  await update(db, secret, run, { answered_by: answeredBy, started: true });
  // The AI assistant answers on OpenAI's side; a 15-minute cap is the backstop if nobody hangs up.
  return twiml(`<Dial timeLimit="900" answerOnBridge="true"><Sip>${escapeXml(sipUri(run))}</Sip></Dial>`);
}
