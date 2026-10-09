import { after, NextResponse } from "next/server";
import { startWatch } from "@/lib/start-watch";
import { automationSecret } from "@/lib/automation";
import {
  acceptCall,
  acceptLive,
  greetCall,
  rejectCall,
  runFromSipHeaders,
  validOpenAIWebhook,
  type CallContext,
} from "@/lib/live";
import {
  receptionFromSipHeaders,
  receptionInstructions,
  receptionUpdate,
  startReceptionWatch,
  type ReceptionContext,
} from "@/lib/reception";
import { update } from "@/lib/screening";
import { webhookDb } from "@/app/api/twilio/webhook";

// The caller is already on the line when the assistant joins. A short wait first, so the audio is flowing
// both ways before it speaks (calls answered within seconds of the assistant joining once went silent).
const GREET_AFTER_MS = 2500;
const GO_AHEAD =
  "The caller is on the line now. Start: greet them right away with your opening.";

// OpenAI tells us a bridged call is waiting. We find which screening it is and accept it with that
// candidate's brief; anything we can't match is turned away.
export async function POST(request: Request) {
  const raw = await request.text();
  if (!validOpenAIWebhook(raw, request.headers))
    return new NextResponse("forbidden", { status: 403 });
  const event = JSON.parse(raw) as {
    type?: string;
    data?: { session_id?: string; call_id?: string; sip_headers?: unknown };
  };
  // Each call also raises realtime.call.incoming with an rtc_ id that the Live accept endpoint doesn't
  // know, so only the live.* events are handled.
  if (
    !["live.transport.incoming", "live.call.incoming"].includes(
      event.type ?? "",
    )
  ) {
    return NextResponse.json({ ok: true });
  }
  const sessionId = event.data?.session_id ?? event.data?.call_id;
  if (!sessionId) return NextResponse.json({ ok: true });

  const db = webhookDb();
  const secret = automationSecret()!;
  const url = new URL(request.url);
  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;

  // Someone called JPR's line and was put through to the answering agent.
  const reception = receptionFromSipHeaders(event.data?.sip_headers);
  if (reception) {
    const { data: rc } = await db.rpc("reception_get", {
      p_secret: secret,
      p_id: reception,
    });
    const c = rc as unknown as ReceptionContext | null;
    if (!c || c.status !== "in_progress" || c.live_session_id) {
      await rejectCall(sessionId);
      return NextResponse.json({ ok: true, rejected: true });
    }
    try {
      await acceptLive(sessionId, receptionInstructions(c));
    } catch (e) {
      console.error("Accept failed (answering agent)", e);
      await receptionUpdate(db, secret, reception, {
        process_note: `OpenAI wouldn't take the call: ${String(e).slice(0, 300)}`,
      });
      return NextResponse.json({ ok: false });
    }
    await receptionUpdate(db, secret, reception, {
      live_session_id: sessionId,
      started: true,
    });
    await startReceptionWatch(origin, reception, sessionId, Date.now());
    after(async () =>
      console.info(
        "Answering agent greeting:",
        await greetCall(sessionId, GO_AHEAD, GREET_AFTER_MS),
      ),
    );
    return NextResponse.json({ ok: true });
  }

  let run = runFromSipHeaders(event.data?.sip_headers);
  if (!run) {
    const { data } = await db.rpc("screening_awaiting_agent", {
      p_secret: secret,
    });
    run = (data as string | null) ?? null;
  }
  const { data } = run
    ? await db.rpc("screening_get", { p_secret: secret, p_run: run })
    : { data: null };
  const ctx = data as unknown as CallContext | null;
  if (!run || !ctx || ctx.status !== "in_progress" || ctx.live_session_id) {
    await rejectCall(sessionId);
    return NextResponse.json({ ok: true, rejected: true });
  }

  // A candidate who called in and was handed to the screening agent: it greets them, not the other way round.
  const { data: inbound } = await db.rpc("screening_run_inbound", {
    p_secret: secret,
    p_run: run,
  });
  try {
    await acceptCall(sessionId, { ...ctx, inbound: Boolean(inbound) });
  } catch (e) {
    console.error("Accept failed", e);
    await update(db, secret, run, {
      process_note: `OpenAI wouldn't take the call: ${String(e).slice(0, 300)}`,
    });
    return NextResponse.json({ ok: false });
  }
  await update(db, secret, run, { live_session_id: sessionId, started: true });
  // Stays on the call so the assistant can hang up once it's over.
  await startWatch(origin, run, sessionId, Date.now());
  if (inbound)
    after(async () =>
      console.info(
        "Inbound screening greeting:",
        await greetCall(sessionId, GO_AHEAD, GREET_AFTER_MS),
      ),
    );
  return NextResponse.json({ ok: true });
}
