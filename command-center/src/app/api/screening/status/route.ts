import { automationSecret } from "@/lib/automation";
import { validRunSig, type CallContext } from "@/lib/live";
import { missedCall, update } from "@/lib/screening";
import { EMPTY_TWIML, readTwilio, webhookDb } from "@/app/api/twilio/webhook";

// The assistant's side of the call ended. Usually /api/screening/dialed has already filed the call;
// this catches the rest: the assistant never picked up, or it hung up first (the call watcher ends
// calls that way), in which case the candidate's side never reports back.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const db = webhookDb();
  const secret = automationSecret()!;
  const status = p.CallStatus ?? "";
  const { data } = await db.rpc("screening_get", { p_secret: secret, p_run: run });
  const ctx = data as unknown as (CallContext & { answered_by?: string | null; ended_at?: string | null }) | null;
  if (!ctx || ctx.status !== "in_progress" || ctx.ended_at) return EMPTY_TWIML.clone();

  if (["busy", "no-answer", "failed", "canceled"].includes(status)) {
    await update(db, secret, run, { status: "failed", ended: true, process_note: "The AI assistant didn't pick up, so the candidate wasn't called." });
    return EMPTY_TWIML.clone();
  }
  if (status !== "completed") return EMPTY_TWIML.clone();

  if (ctx.answered_by !== "answered") {
    await missedCall(db, secret, run, "No answer");
  } else if (ctx.live_session_id) {
    // Includes the few seconds of ringing before they picked up.
    await update(db, secret, run, { duration_seconds: p.CallDuration ? Number(p.CallDuration) : null, ended: true, process_state: "pending" });
  } else {
    await update(db, secret, run, { status: "failed", ended: true, process_note: "The AI assistant wasn't on the line." });
  }
  return EMPTY_TWIML.clone();
}
