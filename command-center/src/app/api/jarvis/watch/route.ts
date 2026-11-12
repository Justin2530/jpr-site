import { after } from "next/server";
import { automationSecret } from "@/lib/automation";
import { watchCall } from "@/lib/call-watch";
import { handleVoice } from "@/lib/jarvis";
import { startJarvisWatch, validJarvisSig } from "@/lib/jarvis-call";
import { webhookDb } from "@/app/api/twilio/webhook";

// Stays on a Jarvis call, one slice at a time (like /api/reception/watch): answers every hand-off from the voice
// with the Jarvis brain, and hangs up after the goodbye.
export const maxDuration = 300;
const SLICE_MS = 240_000;
const MAX_SLICES = 5;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!validJarvisSig(id, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const { sessionId, callStartedAt, slice } = (await request.json()) as {
    sessionId: string;
    callStartedAt: number;
    slice: number;
  };
  const db = webhookDb();
  const secret = automationSecret()!;
  const rpc = db.rpc.bind(db) as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown }>;
  const { data } = await rpc("jarvis_call_get", { p_secret: secret, p_id: id });
  const call = data as { live_session_id: string | null; status: string } | null;
  if (!call || call.live_session_id !== sessionId || call.status !== "in_progress")
    return Response.json({ ok: true, skipped: true });

  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  after(async () => {
    const result = await watchCall({
      sessionId,
      runId: id,
      callStartedAt,
      budgetMs: SLICE_MS,
      slice,
      log: console.info,
      onDelegation: (heard) => handleVoice(db, secret, heard, origin),
      report: async (note) => {
        await rpc("jarvis_call_update", { p_secret: secret, p_id: id, p_note: note });
      },
    });
    if (!result.done && slice < MAX_SLICES) await startJarvisWatch(origin, id, sessionId, callStartedAt, slice + 1);
    else await rpc("jarvis_call_update", { p_secret: secret, p_id: id, p_ended: true });
  });
  return Response.json({ ok: true }, { status: 202 });
}
