"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { automationSecret } from "@/lib/automation";
import { accessToken, gmailPdfs, googleReady, openToken, type Attachment } from "@/lib/google";
import { emailClient, firstName, messageCandidate, relayLogger, type RelayCtx } from "@/lib/relay";
import { headers } from "next/headers";

// Justin's clicks on offers and counteroffers. Each sends from his own Gmail, logs on the candidate's
// history, and turns the candidate's automation back on so the relay can read the answer.

export type RelayResult = { ok: boolean; message: string };

async function setup(cjId: string) {
  const { supabase, userId } = await requireStaff();
  const secret = automationSecret();
  if (!secret) throw new Error("Automation isn't set up on this deployment.");
  const { data: ctx, error } = await supabase.rpc("relay_context_staff", { p_cj: cjId });
  if (error || !ctx) throw new Error(error?.message ?? "Couldn't load this candidate.");
  const { data: account } = await supabase.from("google_accounts").select("email, token_enc").eq("staff_id", userId).maybeSingle();
  if (!account || !googleReady()) throw new Error("Connect your Gmail in Settings first.");
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return {
    supabase,
    userId,
    ctx: ctx as unknown as RelayCtx,
    sender: { email: account.email, token: account.token_enc },
    log: relayLogger(supabase, secret, cjId),
    origin,
  };
}

async function finish(supabase: Awaited<ReturnType<typeof setup>>["supabase"], ctx: RelayCtx, kinds: string[]) {
  await supabase.rpc("set_candidate_automation", { p_candidate: ctx.candidate_id, p_on: true });
  await supabase
    .from("action_items")
    .update({ status: "done", resolved_at: new Date().toISOString() })
    .eq("candidate_job_id", ctx.candidate_job_id)
    .in("kind", kinds)
    .eq("status", "open");
  revalidatePath(`/candidates/${ctx.candidate_id}`);
  revalidatePath("/");
}

const fail = (e: unknown): RelayResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong." });

export async function saveOffer(input: { offerId: string; terms: string; startDate: string }): Promise<RelayResult> {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("offers")
    .update({ terms: input.terms.trim(), start_date: input.startDate || null })
    .eq("id", input.offerId)
    .select("candidate_jobs(candidate_id)")
    .single();
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/candidates/${data.candidate_jobs?.candidate_id}`);
  return { ok: true, message: "Saved." };
}

// Send offer: the exact terms go to the candidate by text and email, with any offer PDF the client sent.
export async function sendOffer(input: { offerId: string; terms: string; startDate: string }): Promise<RelayResult> {
  try {
    const { supabase } = await requireStaff();
    const { data: offer } = await supabase.from("offers").select("*").eq("id", input.offerId).single();
    if (!offer) return { ok: false, message: "That offer is gone." };
    if (!["review", "ready", "confirm_asked"].includes(offer.status)) return { ok: false, message: "This offer was already sent." };
    const terms = input.terms.trim();
    if (!terms) return { ok: false, message: "Add the terms first." };
    const { ctx, sender, log, origin, userId } = await setup(offer.candidate_job_id);
    let attachments: Attachment[] = [];
    if (offer.source_message_id) {
      try {
        attachments = await gmailPdfs(await accessToken(openToken(sender.token)), offer.source_message_id);
      } catch (e) {
        console.error("Couldn't fetch the offer PDF", e);
      }
    }
    const first = firstName(ctx.full_name);
    const sent = await messageCandidate(
      ctx,
      log,
      origin,
      `Hi ${first}, it's Justin with JPR. Great news, ${ctx.company} is offering you the ${ctx.job_title} position! Here are the terms:\n${terms}\nI emailed them to you too. Let me know if you accept.`,
      {
        summary: `Offer sent to ${ctx.full_name}`,
        both: true,
        sender,
        email: {
          subject: `Your offer from ${ctx.company}: ${ctx.job_title}`,
          body: `Hi ${first},\n\nGreat news! ${ctx.company} is offering you the ${ctx.job_title} position. Here are the terms:\n\n${terms}\n\n${
            attachments.length ? "The offer letter is attached.\n\n" : ""
          }Just reply to let me know if you accept, or if you have any questions.\n\nThanks!`,
          attachments,
        },
      },
    );
    if (!sent) return { ok: false, message: `${first} has no phone or email I can use.` };
    await supabase
      .from("offers")
      .update({
        status: "sent",
        waiting_on: "candidate",
        terms,
        start_date: input.startDate || offer.start_date,
        sent_at: new Date().toISOString(),
        decided_by: userId,
      })
      .eq("id", offer.id);
    await finish(supabase, ctx, ["offer"]);
    return { ok: true, message: `Sent to ${first}${attachments.length ? " with the offer letter" : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

// Ask the client to confirm before the offer goes to the candidate. Their yes brings the card back.
export async function askClientToConfirm(offerId: string): Promise<RelayResult> {
  try {
    const { supabase } = await requireStaff();
    const { data: offer } = await supabase.from("offers").select("*").eq("id", offerId).single();
    if (!offer || !["review", "ready"].includes(offer.status)) return { ok: false, message: "This offer can't be confirmed now." };
    const { ctx, sender, log } = await setup(offer.candidate_job_id);
    await emailClient(
      ctx,
      log,
      `Hi ${firstName(ctx.contact_name)},\n\nWould you like me to formally extend this offer to ${firstName(ctx.full_name)}?\n\nThanks!`,
      `Asked ${ctx.contact_name ?? ctx.company} to confirm ${ctx.full_name}'s offer`,
      sender,
    );
    await supabase.from("offers").update({ status: "confirm_asked", waiting_on: "client" }).eq("id", offer.id);
    await finish(supabase, ctx, ["offer"]);
    return { ok: true, message: `Asked ${firstName(ctx.contact_name)} to confirm.` };
  } catch (e) {
    return fail(e);
  }
}

export async function dropOffer(offerId: string): Promise<RelayResult> {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("offers")
    .update({ status: "withdrawn", waiting_on: null })
    .eq("id", offerId)
    .select("candidate_job_id, candidate_jobs(candidate_id)")
    .single();
  if (error) return { ok: false, message: error.message };
  await supabase.from("relay_messages").update({ status: "cancelled" }).eq("offer_id", offerId).eq("status", "awaiting");
  revalidatePath(`/candidates/${data.candidate_jobs?.candidate_id}`);
  return { ok: true, message: "Dropped. Nothing was sent." };
}

// A counteroffer message, word for word, after Justin's click.
export async function sendRelayMessage(input: { id: string; body: string }): Promise<RelayResult> {
  try {
    const { supabase, userId } = await requireStaff();
    const { data: m } = await supabase.from("relay_messages").select("*").eq("id", input.id).single();
    if (!m || m.status !== "awaiting") return { ok: false, message: "This message was already handled." };
    const body = input.body.trim();
    if (!body) return { ok: false, message: "The message is empty." };
    const { ctx, sender, log, origin } = await setup(m.candidate_job_id);
    if (m.to_party === "client") {
      await emailClient(ctx, log, body, `Counteroffer from ${ctx.full_name} to ${ctx.contact_name ?? ctx.company}`, sender);
    } else {
      const sent = await messageCandidate(ctx, log, origin, body, { summary: `${ctx.company}'s answer to ${ctx.full_name}`, sender });
      if (!sent) return { ok: false, message: `${firstName(ctx.full_name)} has no phone or email I can use.` };
    }
    await supabase
      .from("relay_messages")
      .update({ status: "sent", body, decided_by: userId, decided_at: new Date().toISOString() })
      .eq("id", m.id);
    if (m.offer_id) await supabase.from("offers").update({ waiting_on: m.to_party }).eq("id", m.offer_id);
    await finish(supabase, ctx, ["offer"]);
    return { ok: true, message: "Sent." };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelRelayMessage(id: string): Promise<RelayResult> {
  const { supabase, userId } = await requireStaff();
  const { data, error } = await supabase
    .from("relay_messages")
    .update({ status: "cancelled", decided_by: userId, decided_at: new Date().toISOString() })
    .eq("id", id)
    .select("candidate_jobs(candidate_id)")
    .single();
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/candidates/${data.candidate_jobs?.candidate_id}`);
  return { ok: true, message: "Not sent. It's yours to handle." };
}

// The candidate's own automation switch.
export async function setCandidateAutomation(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id") ?? "");
  const { error } = await supabase.rpc("set_candidate_automation", { p_candidate: id, p_on: form.get("on") === "true" });
  if (error) throw new Error(error.message);
  revalidatePath(`/candidates/${id}`);
}

// Pilot: while "pilot only" is on, automation runs only on jobs marked as the pilot.
export async function setJobPilot(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id") ?? "");
  const { error } = await supabase.from("jobs").update({ automation_pilot: form.get("on") === "true" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
}

export async function setPilotOnly(form: FormData) {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") throw new Error("Only the owner can change this.");
  const { error } = await supabase.rpc("set_pilot_only", { p_on: form.get("on") === "true" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

// AI calls in automated recruiting: off means texts and emails only, and booked calls go to Justin.
export async function setAiCalls(form: FormData) {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") throw new Error("Only the owner can change this.");
  const { error } = await supabase.rpc("set_ai_calls", { p_on: form.get("on") === "true" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
