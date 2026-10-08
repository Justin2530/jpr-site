import { automationSecret } from "@/lib/automation";
import { validRunSig, type CallContext } from "@/lib/live";
import {
  receptionUpdate,
  validReceptionSig,
  type ReceptionContext,
} from "@/lib/reception";
import { update } from "@/lib/screening";
import {
  readTwilio,
  twiml,
  voicemailTwiml,
  webhookDb,
} from "@/app/api/twilio/webhook";

// A call put through to the answering agent (kind=reception) or, for a calling candidate, the screening
// agent (kind=screening) is over. A finished call goes to the note-taker. If the assistant never came on
// the line, the caller gets JPR's voicemail instead of silence.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id") ?? "";
  const sig = url.searchParams.get("sig");
  const ok =
    kind === "screening"
      ? validRunSig(id, sig)
      : kind === "reception" && validReceptionSig(id, sig);
  if (!ok) return new Response("Forbidden", { status: 403 });

  const db = webhookDb();
  const secret = automationSecret()!;
  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  const answered = ["completed", "answered"].includes(p.DialCallStatus ?? "");
  const duration = p.DialCallDuration ? Number(p.DialCallDuration) : null;

  let live = false;
  if (kind === "screening") {
    const { data } = await db.rpc("screening_get", {
      p_secret: secret,
      p_run: id,
    });
    live = Boolean((data as unknown as CallContext | null)?.live_session_id);
    await update(db, secret, id, {
      duration_seconds: duration,
      ended: true,
      ...(answered && live
        ? { process_state: "pending" }
        : {
            status: "failed",
            process_note:
              "They called in, but the AI assistant didn't come on the line.",
          }),
    });
  } else {
    const { data } = await db.rpc("reception_get", {
      p_secret: secret,
      p_id: id,
    });
    live = Boolean(
      (data as unknown as ReceptionContext | null)?.live_session_id,
    );
    await receptionUpdate(db, secret, id, {
      duration_seconds: duration,
      ended: true,
      ...(answered && live
        ? { process_state: "pending" }
        : {
            status: "failed",
            process_note: "The AI assistant didn't come on the line.",
          }),
    });
  }
  if (answered && live) return twiml("<Hangup/>");
  return twiml(
    voicemailTwiml(
      origin,
      "Sorry, we couldn't take your call just now. Please leave a message for J P R after the tone, or text this number.",
    ),
  );
}
