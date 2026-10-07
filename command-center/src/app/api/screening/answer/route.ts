import { escapeXml, toE164, twilioNumber, webhookUrl } from "@/lib/twilio";
import { automationSecret } from "@/lib/automation";
import { validRunSig, type CallContext } from "@/lib/live";
import { update } from "@/lib/screening";
import { readTwilio, webhookDb } from "@/app/api/twilio/webhook";

const twiml = (xml: string) =>
  new Response(`<Response>${xml}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });

// The AI assistant picked up (it's called first). Now ring the candidate and bridge them in, so they
// hear the assistant the moment they answer. A 15-minute cap is the backstop if nobody hangs up.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig")))
    return new Response("Forbidden", { status: 403 });
  const db = webhookDb();
  const secret = automationSecret()!;
  const { data } = await db.rpc("screening_get", {
    p_secret: secret,
    p_run: run,
  });
  const ctx = data as unknown as CallContext | null;
  const to = toE164(ctx?.phone);
  if (!ctx || !to || ctx.status !== "in_progress") {
    if (ctx)
      await update(db, secret, run, {
        status: "failed",
        process_note: "No phone number on file",
        ended: true,
      });
    return twiml("<Hangup/>");
  }
  const q = url.search;
  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  // A few seconds before ringing them. When the candidate picked up within seconds of the AI joining,
  // they never heard it (it talked, the audio didn't reach the phone); a later pickup always worked.
  return twiml(
    `<Pause length="4"/>` +
      `<Dial timeLimit="900" timeout="30" callerId="${escapeXml(twilioNumber!)}" action="${escapeXml(webhookUrl(origin, `/api/screening/dialed${q}`))}">` +
      `<Number statusCallbackEvent="answered" statusCallback="${escapeXml(webhookUrl(origin, `/api/screening/answered${q}`))}">${escapeXml(to)}</Number>` +
      `</Dial>`,
  );
}
