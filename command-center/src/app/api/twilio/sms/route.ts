import { escapeXml, toE164, twilioApi, twilioNumber, webhookUrl } from "@/lib/twilio";
import { after } from "next/server";
import { automationSecret } from "@/lib/automation";
import { sendPushes } from "@/lib/push";
import { EMPTY_TWIML, readTwilio, webhookDb } from "../webhook";

function reply(text: string) {
  return new Response(`<Response><Message>${escapeXml(text)}</Message></Response>`, { headers: { "Content-Type": "text/xml" } });
}

// A text arrived on JPR's number.
// From anyone else: file it on the matching candidate or contact, then forward it to Justin's cell.
// From Justin's own cell: it's his reply to a forwarded text, so send it on from the business number.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const secret = process.env.TWILIO_WEBHOOK_SECRET ?? "";
  const db = webhookDb();
  const url = new URL(request.url);
  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  const media = Number(p.NumMedia ?? 0) > 0 ? " [picture attached, open Twilio to view]" : "";
  const body = `${p.Body ?? ""}${media}`.trim();

  const { data: ownerCell } = await db.rpc("twilio_forward_number", { p_secret: secret });
  const cell = toE164(ownerCell);

  if (cell && toE164(p.From) === cell) {
    // "Eric: see you at 3" goes to Eric. With no name it only sends when exactly one person texted in the
    // last day; otherwise it asks, so a message never lands with the wrong candidate.
    const named = body.match(/^\s*([A-Za-z][A-Za-z.' -]{0,40}?)\s*:\s*([\s\S]+)$/);
    let target: { phone: string; name: string } | undefined;
    let text = body;
    if (named) {
      const { data: matches } = await db.rpc("twilio_relay_target", { p_secret: secret, p_name: named[1] });
      if (matches && matches.length > 1)
        return reply(`More than one ${named[1]} texted recently: ${matches.map((m) => m.name).join(", ")}. Start with the full name.`);
      if (matches?.length === 1) {
        target = matches[0];
        text = named[2].trim();
      }
    }
    if (!target) {
      const { data: recent } = await db.rpc("twilio_relay_target", { p_secret: secret });
      if (!recent?.length)
        return reply(
          'Nobody has texted the business number in the last day. Start with their name, like "Eric: ...", or text them from the Command Center.',
        );
      if (recent.length > 1)
        return reply(
          `Not sent. Who is this for? Start with their name, like "${recent[0].name.split(" ")[0]}: ...". Recent: ${recent.map((r) => r.name).join(", ")}.`,
        );
      target = recent[0];
    }
    const msg = await twilioApi("Messages", {
      To: target.phone,
      From: twilioNumber ?? p.To,
      Body: text,
      StatusCallback: webhookUrl(origin, "/api/twilio/status"),
    });
    await db.rpc("twilio_log_relay", { p_secret: secret, p_sid: msg.sid, p_to: target.phone, p_body: text });
    return EMPTY_TWIML.clone();
  }

  const { error } = await db.rpc("twilio_inbound_text", {
    p_secret: secret,
    p_sid: p.MessageSid ?? p.SmsSid ?? "",
    p_from: p.From ?? "",
    p_to: p.To ?? "",
    p_body: body,
  });
  if (error) {
    console.error("twilio sms webhook", error.message);
    return new Response("Error", { status: 500 }); // Twilio retries
  }
  // Phone notification for the Messages tab, sent after Twilio has its answer.
  after(() => sendPushes(db, automationSecret() ?? "").catch((e) => console.error("Push after text failed", e)));

  if (cell) {
    const { data: name } = await db.rpc("twilio_caller_name", { p_secret: secret, p_from: p.From ?? "" });
    const who = name ?? p.From ?? "Someone";
    const first = name ? name.split(" ")[0] : "them";
    try {
      await twilioApi("Messages", {
        To: cell,
        From: twilioNumber ?? p.To,
        Body: `${who}: ${body}\n\n(To answer, reply "${first}: your message")`,
      });
    } catch (e) {
      console.error("twilio forward to cell", e);
    }
  }
  return EMPTY_TWIML.clone();
}
