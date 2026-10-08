import { after } from "next/server";
import { automationSecret } from "@/lib/automation";
import { watchCall } from "@/lib/call-watch";
import {
  RECEPTION_HANDOFF_REPLY,
  startReceptionWatch,
  validReceptionSig,
  type ReceptionContext,
} from "@/lib/reception";
import { webhookDb } from "@/app/api/twilio/webhook";

// Keeps an answering-agent call watched (hang up after the goodbye, answer hand-offs), one slice at a
// time, like /api/screening/watch.
export const maxDuration = 300;
const SLICE_MS = 270_000;
const MAX_SLICES = 5;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!validReceptionSig(id, url.searchParams.get("sig")))
    return new Response("Forbidden", { status: 403 });
  const { sessionId, callStartedAt, slice } = (await request.json()) as {
    sessionId: string;
    callStartedAt: number;
    slice: number;
  };

  const db = webhookDb();
  const { data } = await db.rpc("reception_get", {
    p_secret: automationSecret()!,
    p_id: id,
  });
  const ctx = data as unknown as ReceptionContext | null;
  if (
    !ctx ||
    ctx.live_session_id !== sessionId ||
    ctx.status !== "in_progress" ||
    ctx.ended_at
  ) {
    return Response.json({ ok: true, skipped: true });
  }

  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  after(async () => {
    const result = await watchCall({
      sessionId,
      runId: id,
      callStartedAt,
      budgetMs: SLICE_MS,
      slice,
      log: console.info,
      handoffReply: RECEPTION_HANDOFF_REPLY,
      report: async (note) => {
        await db.rpc("reception_watch_report", {
          p_id: id,
          p_session: sessionId,
          p_note: note as never,
        });
      },
    });
    if (!result.done && slice < MAX_SLICES)
      await startReceptionWatch(
        origin,
        id,
        sessionId,
        callStartedAt,
        slice + 1,
      );
  });
  return Response.json({ ok: true }, { status: 202 });
}
