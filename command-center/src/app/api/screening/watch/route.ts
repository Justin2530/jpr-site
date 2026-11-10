import { after } from "next/server";
import { automationSecret } from "@/lib/automation";
import { validRunSig, type CallContext } from "@/lib/live";
import { watchCall } from "@/lib/call-watch";
import { startWatch } from "@/lib/start-watch";
import { webhookDb } from "@/app/api/twilio/webhook";

// Keeps a live AI screening call watched (hang up when it's over, answer hand-offs). A function can
// only run a few minutes, so each request watches one slice and then starts the next one.
export const maxDuration = 300;
const SLICE_MS = 270_000;
const MAX_SLICES = 5;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const { sessionId, callStartedAt, slice } = (await request.json()) as {
    sessionId: string;
    callStartedAt: number;
    slice: number;
  };

  const db = webhookDb();
  const { data } = await db.rpc("screening_get", {
    p_secret: automationSecret()!,
    p_run: run,
  });
  const ctx = data as unknown as (CallContext & { ended_at?: string | null }) | null;
  if (!ctx || ctx.live_session_id !== sessionId || ctx.status !== "in_progress" || ctx.ended_at) {
    return Response.json({ ok: true, skipped: true });
  }

  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  after(async () => {
    const result = await watchCall({
      sessionId,
      runId: run,
      callStartedAt,
      budgetMs: SLICE_MS,
      slice,
      log: console.info,
    });
    if (!result.done && slice < MAX_SLICES) await startWatch(origin, run, sessionId, callStartedAt, slice + 1);
  });
  return Response.json({ ok: true }, { status: 202 });
}
