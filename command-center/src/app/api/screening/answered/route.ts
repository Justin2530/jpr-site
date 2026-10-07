import { automationSecret } from "@/lib/automation";
import { candidateAnswered, validRunSig, type CallContext } from "@/lib/live";
import { update } from "@/lib/screening";
import { EMPTY_TWIML, readTwilio, webhookDb } from "@/app/api/twilio/webhook";

// The candidate picked up: let the assistant hear them and have it open the conversation.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const db = webhookDb();
  const secret = automationSecret()!;
  await update(db, secret, run, { answered_by: "answered", started: true });
  const { data } = await db.rpc("screening_get", { p_secret: secret, p_run: run });
  const ctx = data as unknown as CallContext | null;
  if (ctx?.live_session_id) {
    let result = await candidateAnswered(ctx.live_session_id, ctx.full_name).catch((e) => `failed ${String(e)}`);
    if (!result.startsWith("ok")) result = await candidateAnswered(ctx.live_session_id, ctx.full_name).catch((e) => `failed ${String(e)}`);
    console.info("Candidate answered", run, result);
  }
  return EMPTY_TWIML.clone();
}
