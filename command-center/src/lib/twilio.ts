import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio over its REST API (no SDK). Keys live in Vercel environment variables, never in the database.
const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
export const twilioNumber = process.env.TWILIO_PHONE_NUMBER ? toE164(process.env.TWILIO_PHONE_NUMBER) : null;

export function twilioReady() {
  return Boolean(sid && token && twilioNumber);
}

// "(814) 555-1234" → "+18145551234". Returns null when it can't be a dialable number.
export function toE164(phone: string | null | undefined) {
  if (!phone) return null;
  const plus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (plus && digits.length >= 10) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function twilioApi(path: string, params: Record<string, string>, method: "POST" | "GET" = "POST") {
  if (!sid || !token) throw new Error("Twilio isn't connected yet.");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}.json`;
  const body = new URLSearchParams(params);
  const res = await fetch(method === "GET" ? `${url}?${body}` : url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" ? body : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio: ${json.message ?? res.statusText}`);
  return json;
}

// Address Twilio posts back to. The private preview sits behind Vercel sign-in, so the automation
// bypass code rides along; the route still checks Twilio's signature on every request.
export function webhookUrl(origin: string, path: string) {
  const url = new URL(path, origin);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) url.searchParams.set("x-vercel-protection-bypass", bypass);
  return url.toString();
}

// https://www.twilio.com/docs/usage/security#validating-requests
export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | null) {
  if (!token || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", token).update(data, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
