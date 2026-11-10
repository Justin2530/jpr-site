import { runSig } from "@/lib/live";
import { webhookUrl } from "@/lib/twilio";

// Start (or continue) watching a live call: see /api/screening/watch.
export async function startWatch(origin: string, run: string, sessionId: string, callStartedAt: number, slice = 1) {
  const res = await fetch(webhookUrl(origin, `/api/screening/watch?run=${run}&sig=${runSig(run)}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, callStartedAt, slice }),
  }).catch((e) => e as Error);
  if (res instanceof Error || !res.ok) {
    console.error("Couldn't start the call watcher", run, res instanceof Error ? res.message : res.status);
  }
}
