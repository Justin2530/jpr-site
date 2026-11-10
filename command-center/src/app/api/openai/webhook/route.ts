import { NextResponse } from "next/server";
import { startWatch } from "@/lib/start-watch";
import { automationSecret } from "@/lib/automation";
import { acceptCall, rejectCall, holdForAnswer, runFromSipHeaders, validOpenAIWebhook, type CallContext } from "@/lib/live";
import { update } from "@/lib/screening";
import { webhookDb } from "@/app/api/twilio/webhook";

// OpenAI tells us a bridged call is waiting. We find which screening it is and accept it with that
// candidate's brief; anything we can't match is turned away.
export async function POST(request: Request) {
  const raw = await request.text();
  if (!validOpenAIWebhook(raw, request.headers)) return new NextResponse("forbidden", { status: 403 });
  const event = JSON.parse(raw) as { type?: string; data?: { session_id?: string; call_id?: string; sip_headers?: unknown } };
  // Each call also raises realtime.call.incoming with an rtc_ id that the Live accept endpoint doesn't
  // know, so only the live.* events are handled.
  if (!["live.transport.incoming", "live.call.incoming"].includes(event.type ?? "")) {
    return NextResponse.json({ ok: true });
  }
  const sessionId = event.data?.session_id ?? event.data?.call_id;
  if (!sessionId) return NextResponse.json({ ok: true });

  const db = webhookDb();
  const secret = automationSecret()!;
  let run = runFromSipHeaders(event.data?.sip_headers);
  if (!run) {
    const { data } = await db.rpc("screening_awaiting_agent", { p_secret: secret });
    run = (data as string | null) ?? null;
  }
  const { data } = run ? await db.rpc("screening_get", { p_secret: secret, p_run: run }) : { data: null };
  const ctx = data as unknown as CallContext | null;
  if (!run || !ctx || ctx.status !== "in_progress" || ctx.live_session_id) {
    await rejectCall(sessionId);
    return NextResponse.json({ ok: true, rejected: true });
  }

  try {
    await acceptCall(sessionId, ctx);
  } catch (e) {
    console.error("Accept failed", e);
    await update(db, secret, run, { process_note: `OpenAI wouldn't take the call: ${String(e).slice(0, 300)}` });
    return NextResponse.json({ ok: false });
  }
  await update(db, secret, run, { live_session_id: sessionId, started: true });
  console.info("Hold for answer", await holdForAnswer(sessionId).catch((e) => `failed ${String(e)}`));
  // Stays on the call so the assistant can hang up once it's over.
  const url = new URL(request.url);
  await startWatch(`https://${request.headers.get("x-forwarded-host") ?? url.host}`, run, sessionId, Date.now());
  return NextResponse.json({ ok: true });
}
