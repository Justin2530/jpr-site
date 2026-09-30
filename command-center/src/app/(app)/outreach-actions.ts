"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { num, text } from "@/lib/format";

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
