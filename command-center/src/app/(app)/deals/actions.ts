"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { num, text } from "@/lib/format";
import { resolveCompany } from "@/lib/company";
import { Constants, type Enums } from "@/lib/database.types";

function fields(form: FormData) {
  return {
    title: text(form, "title")!,
    contact_id: text(form, "contact_id"),
    stage: (text(form, "stage") ?? "lead") as Enums<"deal_stage">,
    deal_type: text(form, "deal_type") as Enums<"agreement_type"> | null,
    value: num(form, "value"),
    expected_close: text(form, "expected_close"),
    next_step: text(form, "next_step"),
    next_step_on: text(form, "next_step_on"),
    notes: text(form, "notes"),
  };
}

export async function createDeal(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  const company = await resolveCompany(supabase, form, { userId, marketId: markets[0].id });
  const { data, error } = await supabase
    .from("deals")
    .insert({ ...fields(form), company_id: company.id, market_id: company.market_id, owner_id: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/deals/${data.id}`);
}

export async function updateDeal(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  const id = String(form.get("id"));
  const company = await resolveCompany(supabase, form, { userId, marketId: markets[0].id });
  const { error } = await supabase.from("deals").update({ ...fields(form), company_id: company.id }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/deals/${id}`);
  revalidatePath("/deals");
}

export async function moveDeal(id: string, stage: string) {
  const { supabase } = await requireStaff();
  if (!(Constants.public.Enums.deal_stage as readonly string[]).includes(stage)) throw new Error("Unknown stage");
  const { error } = await supabase.from("deals").update({ stage: stage as Enums<"deal_stage"> }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
  revalidatePath("/");
}

export async function setDealStage(form: FormData) {
  await moveDeal(String(form.get("id")), String(form.get("stage")));
}

export async function logDealNote(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const id = String(form.get("deal_id"));
  const summary = text(form, "summary");
  if (!summary) return;
  const { data: deal } = await supabase.from("deals").select("market_id, company_id").eq("id", id).single();
  const kind = ["note", "call", "email", "meeting"].includes(String(form.get("kind"))) ? String(form.get("kind")) : "note";
  const { error } = await supabase
    .from("activities")
    .insert({ deal_id: id, kind, summary, actor_id: userId, market_id: deal?.market_id, company_id: deal?.company_id });
  if (error) throw new Error(error.message);
  revalidatePath(`/deals/${id}`);
}

export async function deleteDeal(form: FormData) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("deals").delete().eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  redirect("/deals");
}
