"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireStaff } from "@/lib/staff";
import { text } from "@/lib/format";
import { toE164, twilioApi, twilioGet, twilioNumber, twilioReady, webhookUrl } from "@/lib/twilio";

export async function saveMyCell(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const raw = text(form, "phone");
  const phone = raw ? toE164(raw) : null;
  if (raw && !phone) throw new Error("That doesn't look like a phone number.");
  const { error } = await supabase.from("staff").update({ phone }).eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

// Point JPR's Twilio number at this app: incoming texts file themselves, incoming calls ring the owner's cell.
export async function connectTwilioNumber(): Promise<{ ok: boolean; message: string }> {
  const { staff } = await requireStaff();
  if (staff.role !== "owner") return { ok: false, message: "Only the owner can change the business number." };
  if (!twilioReady()) return { ok: false, message: "Add the Twilio keys in Vercel first." };
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  try {
    const list = await twilioApi("IncomingPhoneNumbers", { PhoneNumber: twilioNumber! }, "GET");
    const num = list.incoming_phone_numbers?.[0];
    if (!num) return { ok: false, message: `${twilioNumber} isn't on this Twilio account.` };
    await twilioApi(`IncomingPhoneNumbers/${num.sid}`, {
      SmsUrl: webhookUrl(origin, "/api/twilio/sms"),
      SmsMethod: "POST",
      VoiceUrl: webhookUrl(origin, "/api/twilio/voice"),
      VoiceMethod: "POST",
      StatusCallback: webhookUrl(origin, "/api/twilio/status"),
      StatusCallbackMethod: "POST",
    });
    // Texting registration puts the number in a Messaging Service, which by default takes over incoming
    // texts. Tell that service to keep using the number's own webhook (this app).
    const services = await twilioGet("https://messaging.twilio.com/v1/Services?PageSize=50");
    for (const svc of services.services ?? []) {
      const nums = await twilioGet(`https://messaging.twilio.com/v1/Services/${svc.sid}/PhoneNumbers?PageSize=50`);
      const has = (nums.phone_numbers ?? []).some((n: { sid: string }) => n.sid === num.sid);
      if (has && !svc.use_inbound_webhook_on_number) {
        await twilioGet(`https://messaging.twilio.com/v1/Services/${svc.sid}`, { UseInboundWebhookOnNumber: "true" });
      }
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Twilio didn't accept the change." };
  }
  return { ok: true, message: "Connected. Texts to your business number now land here, and calls ring your cell." };
}
