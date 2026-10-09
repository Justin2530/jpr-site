"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireStaff } from "@/lib/staff";
import { num, text } from "@/lib/format";
import { escapeXml, toE164, twilioApi, twilioNumber, twilioReady, webhookUrl } from "@/lib/twilio";
import { accessToken, googleReady, openToken, sendGmail } from "@/lib/google";

const KINDS = ["call", "text", "email", "note"];

// Log a call, text or email (until Twilio and Gmail log them automatically), with what was said.
export async function logCorrespondence(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const kind = KINDS.includes(String(form.get("kind"))) ? String(form.get("kind")) : "note";
  const body = text(form, "body");
  const summary = text(form, "summary") ?? (body ? body.split("\n")[0].slice(0, 140) : null);
  if (!summary) return;
  const minutes = num(form, "minutes");
  const { error } = await supabase.from("activities").insert({
    kind,
    summary,
    body,
    direction: kind === "note" ? null : form.get("direction") === "in" ? "in" : "out",
    duration_seconds: minutes != null ? Math.round(minutes * 60) : null,
    candidate_id: text(form, "candidate_id"),
    contact_id: text(form, "contact_id"),
    company_id: text(form, "company_id"),
    deal_id: text(form, "deal_id"),
    actor_id: userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(String(form.get("path") ?? "/"));
}

export async function addReminder(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  const title = text(form, "title");
  if (!title) return;
  const { error } = await supabase.from("action_items").insert({
    title,
    kind: "reminder",
    priority: 2,
    due_on: text(form, "due_on"),
    candidate_id: text(form, "candidate_id"),
    contact_id: text(form, "contact_id"),
    company_id: text(form, "company_id"),
    market_id: markets[0]?.id ?? null,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(String(form.get("path") ?? "/"));
  revalidatePath("/");
}

export async function completeReminder(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const { error } = await supabase
    .from("action_items")
    .update({ status: "done", resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath(String(form.get("path") ?? "/"));
  revalidatePath("/");
}

// Where Twilio should post delivery and call updates: this app's own address.
async function origin() {
  const h = await headers();
  return `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

type Reach = { candidate_id?: string | null; contact_id?: string | null; company_id?: string | null; deal_id?: string | null };

function reachLinks(form: FormData): Reach {
  return {
    candidate_id: text(form, "candidate_id"),
    contact_id: text(form, "contact_id"),
    company_id: text(form, "company_id"),
    deal_id: text(form, "deal_id"),
  };
}

// Blocks texting anyone who replied STOP.
async function optedOut(supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"], links: Reach) {
  if (links.candidate_id) {
    const { data } = await supabase.from("candidates").select("sms_opted_out_at").eq("id", links.candidate_id).maybeSingle();
    if (data?.sms_opted_out_at) return true;
  }
  if (links.contact_id) {
    const { data } = await supabase.from("contacts").select("sms_opted_out_at").eq("id", links.contact_id).maybeSingle();
    if (data?.sms_opted_out_at) return true;
  }
  return false;
}

export type OutreachResult = { ok: boolean; message: string; sid?: string };

// Send a text from JPR's Twilio number and file it on the person's history.
export async function sendText(form: FormData): Promise<OutreachResult> {
  const { supabase, userId, markets } = await requireStaff();
  const to = toE164(text(form, "to"));
  const body = text(form, "body");
  const name = text(form, "name") ?? "them";
  const links = reachLinks(form);
  if (!twilioReady()) return { ok: false, message: "Twilio isn't connected yet." };
  if (!to) return { ok: false, message: "That phone number doesn't look right." };
  if (!body) return { ok: false, message: "Write a message first." };
  if (await optedOut(supabase, links)) return { ok: false, message: `${name} replied STOP, so texting is blocked.` };

  let sid: string;
  try {
    const msg = await twilioApi("Messages", {
      To: to,
      From: twilioNumber!,
      Body: body,
      StatusCallback: webhookUrl(await origin(), "/api/twilio/status"),
    });
    sid = msg.sid;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Twilio didn't accept the text." };
  }
  const { error } = await supabase.from("activities").insert({
    kind: "text",
    direction: "out",
    summary: `Text to ${name}`,
    body,
    ...links,
    market_id: markets[0]?.id ?? null,
    actor_id: userId,
    external_id: sid,
    external_status: "queued",
    phone_number: to,
  });
  if (error) return { ok: false, message: `Sent, but not saved to history: ${error.message}` };
  // Answering clears their "Text from" item on What needs me.
  if (links.candidate_id || links.contact_id)
    await supabase
      .from("action_items")
      .update({ status: "done", resolved_at: new Date().toISOString(), resolved_by: userId })
      .eq("kind", "reply")
      .eq("status", "open")
      .eq(links.candidate_id ? "candidate_id" : "contact_id", (links.candidate_id ?? links.contact_id)!);
  revalidatePath(String(form.get("path") ?? "/"));
  return { ok: true, message: `Text sent to ${name}.` };
}

// Click to call: Twilio rings the user's own cell first, then connects them to the person.
// The person sees JPR's number. Calls are not recorded (Pennsylvania needs everyone's consent).
export async function startCall(form: FormData): Promise<OutreachResult> {
  const { supabase, userId, staff, markets } = await requireStaff();
  const to = toE164(text(form, "to"));
  const name = text(form, "name") ?? "them";
  const links = reachLinks(form);
  const myCell = toE164(staff.phone);
  if (!twilioReady()) return { ok: false, message: "Twilio isn't connected yet." };
  if (!myCell) return { ok: false, message: "Add your cell number in Settings first." };
  if (!to) return { ok: false, message: "That phone number doesn't look right." };

  const twiml =
    `<Response><Say>Connecting you to ${escapeXml(name)}.</Say>` +
    `<Dial callerId="${escapeXml(twilioNumber!)}" timeout="30">${escapeXml(to)}</Dial></Response>`;
  let sid: string;
  try {
    const call = await twilioApi("Calls", {
      To: myCell,
      From: twilioNumber!,
      Twiml: twiml,
      StatusCallback: webhookUrl(await origin(), "/api/twilio/status"),
    });
    sid = call.sid;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Twilio couldn't start the call." };
  }
  const { error } = await supabase.from("activities").insert({
    kind: "call",
    direction: "out",
    summary: `Call to ${name}`,
    ...links,
    market_id: markets[0]?.id ?? null,
    actor_id: userId,
    external_id: sid,
    external_status: "queued",
    phone_number: to,
  });
  if (error) return { ok: false, message: `Calling, but not saved to history: ${error.message}` };
  revalidatePath(String(form.get("path") ?? "/"));
  return { ok: true, sid, message: `Your phone will ring now. Pick up and you'll be connected to ${name}.` };
}

// Notes added after a call made through the app land on that call's history entry.
export async function addCallNotes(form: FormData) {
  const { supabase } = await requireStaff();
  const body = text(form, "body");
  const summary = text(form, "summary");
  const sid = text(form, "sid");
  if (!sid || (!body && !summary)) return;
  const update: { body?: string; summary?: string } = {};
  if (body) update.body = body;
  if (summary) update.summary = summary;
  const { error } = await supabase.from("activities").update(update).eq("external_id", sid);
  if (error) throw new Error(error.message);
  revalidatePath(String(form.get("path") ?? "/"));
}

// Send an email from the staff member's own Gmail and file it on the person's history.
export async function sendEmail(form: FormData): Promise<OutreachResult> {
  const { supabase, userId, markets } = await requireStaff();
  const to = text(form, "email");
  const subject = text(form, "subject");
  const body = text(form, "body");
  const name = text(form, "name") ?? to ?? "them";
  const links = reachLinks(form);
  if (!googleReady()) return { ok: false, message: "Gmail isn't set up yet." };
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, message: "That email address doesn't look right." };
  if (!subject || !body) return { ok: false, message: "Add a subject and a message." };

  const { data: account } = await supabase.from("google_accounts").select("email, token_enc").eq("staff_id", userId).maybeSingle();
  if (!account) return { ok: false, message: "Connect your Gmail in Settings first." };

  // Files picked on the email form.
  const files = (form.getAll("files") as (File | string)[]).filter((f): f is File => typeof f !== "string" && f.size > 0);
  const attachments = await Promise.all(
    files.map(async (f) => ({ filename: f.name, mimeType: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()) })),
  );

  let sent: { id: string; threadId: string };
  try {
    const threadId = text(form, "thread_id") ?? undefined;
    sent = await sendGmail(await accessToken(openToken(account.token_enc)), { from: account.email, to, subject, body, threadId, attachments });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gmail didn't accept the email.";
    return { ok: false, message: /invalid_grant|decrypt|auth/i.test(msg) ? "Gmail needs reconnecting in Settings." : msg };
  }
  const { error } = await supabase.from("activities").insert({
    kind: "email",
    direction: "out",
    summary: `Email to ${name}: ${subject}`,
    body: files.length ? `${body}\n\nAttached: ${files.map((f) => f.name).join(", ")}` : body,
    ...links,
    market_id: markets[0]?.id ?? null,
    actor_id: userId,
    external_id: sent.id,
    external_thread_id: sent.threadId,
    external_status: "sent",
  });
  revalidatePath(String(form.get("path") ?? "/"));
  if (error) return { ok: false, message: `Sent, but not saved to history: ${error.message}` };
  return { ok: true, message: `Email sent to ${name}${files.length ? ` with ${files.length === 1 ? files[0].name : `${files.length} files`} attached` : ""}.` };
}
