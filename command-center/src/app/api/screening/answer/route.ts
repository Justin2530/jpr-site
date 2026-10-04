import { escapeXml } from "@/lib/twilio";
import { automationSecret } from "@/lib/automation";
import { sipUri, validRunSig } from "@/lib/live";
import { update } from "@/lib/screening";
import { readTwilio, webhookDb } from "@/app/api/twilio/webhook";

const twiml = (xml: string) => new Response(`<Response>${xml}</Response>`, { headers: { "Content-Type": "text/xml" } });

// The candidate's phone was answered. A person gets handed to the AI assistant; an answering machine
// gets a short message (the missed-call text follows from the status callback).
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
    const { data } = await db.rpc("screening_get", { p_secret: secret, p_run: run });
    const ctx = data as { full_name?: string; job_title?: string } | null;
    const name = ctx?.full_name?.split(" ")[0] ?? "there";
    return twiml(
      `<Pause length="1"/><Say voice="Polly.Matthew">Hi ${escapeXml(name)}, this is J P R calling for your phone call about the ${escapeXml(ctx?.job_title ?? "")} position. Sorry we missed you. We'll send you a text to find a better time, or you can reach us at 8 1 4, 8 4 5, 4 3 4 1. Thanks!</Say><Hangup/>`,
    );
  }

  await update(db, secret, run, { answered_by: answeredBy, started: true });
  // The AI assistant answers on OpenAI's side; a 25-minute cap is the backstop if nobody hangs up.
  return twiml(`<Dial timeLimit="1500" answerOnBridge="true"><Sip>${escapeXml(sipUri(run))}</Sip></Dial>`);
}
