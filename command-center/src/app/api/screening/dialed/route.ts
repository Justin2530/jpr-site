import { automationSecret } from "@/lib/automation";
import { validRunSig, type CallContext } from "@/lib/live";
import { missedCall, update } from "@/lib/screening";
import { readTwilio, webhookDb } from "@/app/api/twilio/webhook";

const HANGUP = () => new Response("<Response><Hangup/></Response>", { headers: { "Content-Type": "text/xml" } });

// The candidate's side of the call is over (they hung up, or never answered). Missed calls get a
// text; finished calls go to the note-taker. Then the assistant's side is hung up too.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const db = webhookDb();
  const secret = automationSecret()!;
  const status = p.DialCallStatus ?? "";
  if (status !== "completed" && status !== "answered") {
    await missedCall(db, secret, run, status === "busy" ? "Line was busy" : "No answer");
    return HANGUP();
  }
  const { data } = await db.rpc("screening_get", { p_secret: secret, p_run: run });
  const ctx = data as unknown as CallContext | null;
  const duration = p.DialCallDuration ? Number(p.DialCallDuration) : null;
  await update(db, secret, run, {
    duration_seconds: duration,
    ended: true,
    ...(ctx?.live_session_id ? { process_state: "pending" } : { status: "failed", process_note: "The AI assistant wasn't on the line." }),
  });
  return HANGUP();
}
