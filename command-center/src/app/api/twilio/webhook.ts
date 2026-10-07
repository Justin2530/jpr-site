import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { validTwilioSignature } from "@/lib/twilio";

// Reads a Twilio webhook and proves it came from Twilio. Returns null (and the caller answers 403) if not.
export async function readTwilio(request: Request) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });
  // Twilio signs the exact public address it posted to, bypass code included.
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const signed = `https://${host}${url.pathname}${url.search}`;
  if (!validTwilioSignature(signed, params, request.headers.get("x-twilio-signature"))) return null;
  return params;
}

// No user session here: the database only lets this key call the two narrow Twilio functions,
// and each of those checks the webhook secret.
export function webhookDb() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
}

export const EMPTY_TWIML = new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
