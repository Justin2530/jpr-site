import { escapeXml, toE164, twilioNumber, webhookUrl } from "@/lib/twilio";
import { automationSecret } from "@/lib/automation";
import { liveReady, runSig, sipUri } from "@/lib/live";
import { receptionSig, receptionSipUri } from "@/lib/reception";
import { readTwilio, twiml, voicemailTwiml, webhookDb } from "../webhook";

// Hours (Eastern) a call to JPR's number rings Justin's cell, the same window our texts keep.
const RING_FROM = 8;
const RING_UNTIL = 21;

function ringHours() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "America/New_York",
    }).format(new Date()),
  );
  return hour >= RING_FROM && hour < RING_UNTIL;
}

type Route = {
  owner: boolean;
  receptionist_on: boolean;
  screen_cj: string | null;
};

// Someone called JPR's number. Log it, then:
// - The answering agent on (Settings), or the call is from Justin's own cell (his test line):
//   a candidate we're working for one job goes straight to the screening agent; anyone else rings
//   Justin first during ring hours, and the answering agent picks up whatever he doesn't take.
// - Otherwise, as before: ring Justin's cell showing the business number, with a short announcement
//   and "press 1" so his cell's voicemail can never take the call. Anything he doesn't take goes to
//   JPR's voicemail.
export async function POST(request: Request) {
  const p = await readTwilio(request);
  if (!p) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  const missed =
    "Sorry we missed you. Please leave a message for J P R after the tone, or text this number.";
  const db = webhookDb();
  const auto = automationSecret();
  const from = p.From ?? "";

  const route = async (): Promise<Route | null> => {
    if (!auto || !liveReady()) return null;
    const { data, error } = await db.rpc("reception_route", {
      p_secret: auto,
      p_from: from,
    });
    if (error) console.error("reception_route failed", error.message);
    return (data as unknown as Route | null) ?? null;
  };
  // Put the caller through to the answering agent (or, for a candidate, the screening agent).
  const toAgent = async (r: Route) => {
    try {
      if (r.screen_cj) {
        const { data: run, error } = await db.rpc("reception_start_screening", {
          p_secret: auto!,
          p_cj: r.screen_cj,
          p_sid: p.CallSid ?? "",
        });
        if (error || !run) throw new Error(error?.message ?? "no run");
        const done = webhookUrl(
          origin,
          `/api/reception/ended?kind=screening&id=${run}&sig=${runSig(run)}`,
        );
        return twiml(
          `<Dial timeLimit="900" action="${escapeXml(done)}"><Sip>${escapeXml(sipUri(run))}</Sip></Dial>`,
        );
      }
      const { data, error } = await db.rpc("reception_open", {
        p_secret: auto!,
        p_sid: p.CallSid ?? "",
        p_from: from,
      });
      const id = (data as { id?: string } | null)?.id;
      if (error || !id) throw new Error(error?.message ?? "no call record");
      const done = webhookUrl(
        origin,
        `/api/reception/ended?kind=reception&id=${id}&sig=${receptionSig(id)}`,
      );
      return twiml(
        `<Dial timeLimit="900" action="${escapeXml(done)}"><Sip>${escapeXml(receptionSipUri(id))}</Sip></Dial>`,
      );
    } catch (e) {
      console.error("Couldn't reach the answering agent", e);
      return twiml(voicemailTwiml(origin, missed));
    }
  };

  // The forwarded call ended: hang up if Justin talked to them, otherwise the answering agent (if it's
  // on) or JPR's voicemail takes it.
  if (url.searchParams.get("step") === "after") {
    console.info("Business call ended", p.CallSid, {
      bridged: p.DialBridged,
      status: p.DialCallStatus,
    });
    if (p.DialBridged === "true") return twiml("<Hangup/>");
    const r = await route();
    return r?.receptionist_on
      ? toAgent({ ...r, screen_cj: null })
      : twiml(voicemailTwiml(origin, missed));
  }

  const secret = process.env.TWILIO_WEBHOOK_SECRET ?? "";
  const [{ data }, r] = await Promise.all([
    db.rpc("twilio_forward_number", { p_secret: secret }),
    route(),
    p.CallSid
      ? db.rpc("twilio_inbound_call", {
          p_secret: secret,
          p_sid: p.CallSid,
          p_from: from,
        })
      : null,
  ]);
  const cell = toE164(data);
  if (
    r &&
    (r.owner || r.receptionist_on) &&
    (r.owner || r.screen_cj || !cell || !ringHours())
  )
    return toAgent(r);
  if (!cell || !ringHours()) {
    return twiml(
      voicemailTwiml(
        origin,
        "Thanks for calling J P R. Please leave a message after the tone, or text this number, and we will get right back to you.",
      ),
    );
  }
  const whisper = new URL(webhookUrl(origin, "/api/twilio/whisper"));
  whisper.searchParams.set("from", from);
  const after = webhookUrl(origin, "/api/twilio/voice?step=after");
  return twiml(
    `<Dial callerId="${escapeXml(twilioNumber ?? p.To ?? "")}" timeout="25" action="${escapeXml(after)}">` +
      `<Number url="${escapeXml(whisper.toString())}">${escapeXml(cell)}</Number></Dial>`,
  );
}
