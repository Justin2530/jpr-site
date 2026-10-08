"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { automationSecret } from "@/lib/automation";
import { accessToken, googleReady, openToken, sendGmail } from "@/lib/google";
import { SIGNATURE } from "@/lib/submission";

// Justin's clicks on the third eye: its switches in Settings, and sending or skipping a reply it drafted.

export type InboxResult = { ok: boolean; message: string };

async function ownerRpc(
  fn: "set_inbox_agent" | "set_inbox_auto_reply",
  form: FormData,
) {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner")
    throw new Error("Only the owner can change this.");
  const { error } = await supabase.rpc(fn, { p_on: form.get("on") === "true" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function setInboxAgent(form: FormData) {
  await ownerRpc("set_inbox_agent", form);
}

export async function setInboxAutoReply(form: FormData) {
  await ownerRpc("set_inbox_auto_reply", form);
}

// Sends the draft, as edited, from the clicking staff member's Gmail into the candidate's thread.
export async function sendInboxDraft(input: {
  id: string;
  body: string;
}): Promise<InboxResult> {
  try {
    const { supabase, userId } = await requireStaff();
    const secret = automationSecret();
    if (!secret)
      return {
        ok: false,
        message: "Automation isn't set up on this deployment.",
      };
    const body = input.body.trim();
    if (!body) return { ok: false, message: "The reply is empty." };
    const { data: d } = await supabase
      .from("inbox_drafts")
      .select("*")
      .eq("id", input.id)
      .single();
    if (!d || d.status !== "awaiting")
      return { ok: false, message: "This reply was already handled." };
    const { data: account } = await supabase
      .from("google_accounts")
      .select("email, token_enc")
      .eq("staff_id", userId)
      .maybeSingle();
    if (!account || !googleReady())
      return { ok: false, message: "Connect your Gmail in Settings first." };
    const full = `${body}\n\n${SIGNATURE}`;
    const sent = await sendGmail(
      await accessToken(openToken(account.token_enc)),
      {
        from: account.email,
        to: d.to_address,
        subject: d.subject,
        body: full,
        threadId: d.thread_id ?? undefined,
      },
    );
    const { error } = await supabase.rpc("inbox_draft_sent", {
      p_secret: secret,
      p_draft: d.id,
      p_message_id: sent.id,
      p_thread: sent.threadId,
      p_body: full,
      p_staff: userId,
    });
    if (error)
      return {
        ok: false,
        message: `Sent, but it didn't log: ${error.message}`,
      };
    revalidatePath("/");
    revalidatePath(`/candidates/${d.candidate_id}`);
    return { ok: true, message: "Sent." };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Something went wrong.",
    };
  }
}

export async function skipInboxDraft(id: string): Promise<InboxResult> {
  const { supabase } = await requireStaff();
  const { error } = await supabase.rpc("inbox_draft_skip", { p_draft: id });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true, message: "Not sent. It's yours to handle." };
}
