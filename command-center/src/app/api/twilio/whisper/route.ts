import { escapeXml } from "@/lib/twilio";
import { readTwilio, webhookDb } from "../webhook";

// Plays to Justin only, the moment he answers a forwarded call: who is on the line.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const from = new URL(request.url).searchParams.get("from") ?? "";
  const { data: name } = await webhookDb().rpc("twilio_caller_name", { p_secret: process.env.TWILIO_WEBHOOK_SECRET ?? "", p_from: from });
  const digits = from.replace(/\D/g, "").slice(-10).split("").join(" ");
  const who = name ?? (digits ? `a new number, ${digits}` : "an unknown number");
  return new Response(`<Response><Say>J P R call from ${escapeXml(who)}.</Say></Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}
