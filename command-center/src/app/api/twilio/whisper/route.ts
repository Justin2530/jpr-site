import { escapeXml, webhookUrl } from "@/lib/twilio";
import { readTwilio, webhookDb } from "../webhook";

const xml = (body: string) => new Response(`<Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });

// Plays to Justin only, the moment his cell picks up a forwarded call: who is on the line, and press 1 to take it.
// A voicemail box can't press 1, so an unanswered call comes back to JPR's own voicemail instead of his.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  if (url.searchParams.get("step") === "accept") {
    console.info("Business call: Justin pressed", JSON.stringify(p.Digits ?? null), p.CallSid);
    return xml(p.Digits === "1" ? "" : "<Hangup/>");
  }
  const from = url.searchParams.get("from") ?? "";
  const { data: name } = await webhookDb().rpc("twilio_caller_name", {
    p_secret: process.env.TWILIO_WEBHOOK_SECRET ?? "",
    p_from: from,
  });
  const digits = from.replace(/\D/g, "").slice(-10).split("").join(" ");
  const who = name ?? (digits ? `a new number, ${digits}` : "an unknown number");
  const accept = new URL(webhookUrl(`https://${request.headers.get("x-forwarded-host") ?? url.host}`, url.pathname));
  accept.searchParams.set("step", "accept");
  return xml(
    `<Gather numDigits="1" timeout="6" action="${escapeXml(accept.toString())}">` +
      `<Say>J P R call from ${escapeXml(who)}. Press 1 to take it.</Say></Gather><Hangup/>`,
  );
}
