import { automationSecret } from "@/lib/automation";
import { validJarvisSig } from "@/lib/jarvis-call";
import { readTwilio, twiml, webhookDb } from "@/app/api/twilio/webhook";

// Justin's call with Jarvis is over (Twilio's Dial finished): mark it ended.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!validJarvisSig(id, url.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const db = webhookDb();
  const rpc = db.rpc.bind(db) as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown }>;
  await rpc("jarvis_call_update", {
    p_secret: automationSecret()!,
    p_id: id,
    p_ended: true,
    p_note: { dial_status: p.DialCallStatus ?? null, seconds: p.DialCallDuration ? Number(p.DialCallDuration) : null },
  });
  if (!["completed", "answered"].includes(p.DialCallStatus ?? ""))
    return twiml("<Say>Sorry J. P., Jarvis couldn't come on the line. Try again in a minute.</Say><Hangup/>");
  return twiml("<Hangup/>");
}
