import { automationSecret } from "@/lib/automation";
import { validRunSig, type CallContext } from "@/lib/live";
import { missedCall, update } from "@/lib/screening";
import { EMPTY_TWIML, readTwilio, webhookDb } from "@/app/api/twilio/webhook";

// How the screening call ended. Missed calls get a text; finished calls go to the note-taker.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const db = webhookDb();
  const secret = automationSecret()!;
  const status = p.CallStatus ?? "";
  const duration = p.CallDuration ? Number(p.CallDuration) : null;

  if (["busy", "no-answer", "failed", "canceled"].includes(status)) {
    await missedCall(db, secret, run, status === "busy" ? "Line was busy" : "No answer");
    return EMPTY_TWIML.clone();
  }
  if (status !== "completed") return EMPTY_TWIML.clone();

  if (/^machine|^fax/.test(p.AnsweredBy ?? "")) {
    await missedCall(db, secret, run, "Went to voicemail");
    return EMPTY_TWIML.clone();
  }
  const { data } = await db.rpc("screening_get", { p_secret: secret, p_run: run });
  const ctx = data as unknown as CallContext | null;
  if (ctx?.live_session_id) {
    await update(db, secret, run, { duration_seconds: duration, ended: true, process_state: "pending" });
  } else {
    await update(db, secret, run, {
      status: "failed",
      duration_seconds: duration,
      ended: true,
      process_note: "They answered, but the AI assistant never came on the line.",
    });
  }
  return EMPTY_TWIML.clone();
}
