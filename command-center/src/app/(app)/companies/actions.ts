"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { num, text } from "@/lib/format";
import type { Enums } from "@/lib/database.types";

export async function createCompany(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  const { data, error } = await supabase
    .from("companies")
    .insert({
      name: text(form, "name")!,
      status: (text(form, "status") ?? "prospect") as Enums<"company_status">,
      industry: text(form, "industry"),
      city: text(form, "city"),
      phone: text(form, "phone"),
      website: text(form, "website"),
      notes: text(form, "notes"),
      market_id: text(form, "market_id") ?? markets[0].id,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/companies/${data.id}`);
}

export async function updateCompany(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const { error } = await supabase
    .from("companies")
    .update({
      name: text(form, "name")!,
      status: text(form, "status") as Enums<"company_status">,
      industry: text(form, "industry"),
      city: text(form, "city"),
      phone: text(form, "phone"),
      website: text(form, "website"),
      notes: text(form, "notes"),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/companies/${id}`);
}

export async function addContact(form: FormData) {
  const { supabase } = await requireStaff();
  const companyId = String(form.get("company_id"));
  const { error } = await supabase.from("contacts").insert({
    company_id: companyId,
    full_name: text(form, "full_name")!,
    title: text(form, "title"),
    email: text(form, "email"),
    phone: text(form, "phone"),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/companies/${companyId}`);
}

export async function deleteContact(form: FormData) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("contacts").delete().eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath(`/companies/${form.get("company_id")}`);
}

export async function addAgreement(form: FormData) {
  const { supabase } = await requireStaff();
  const companyId = String(form.get("company_id"));
  const { error } = await supabase.from("agreements").insert({
    company_id: companyId,
    type: text(form, "type") as Enums<"agreement_type">,
    status: (text(form, "status") ?? "draft") as Enums<"agreement_status">,
    plan_name: text(form, "plan_name"),
    monthly_price: num(form, "monthly_price"),
    search_capacity: num(form, "search_capacity"),
    fee_percent: num(form, "fee_percent"),
    start_date: text(form, "start_date"),
    end_date: text(form, "end_date"),
    notes: text(form, "notes"),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/companies/${companyId}`);
}

export async function setAgreementStatus(form: FormData) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("agreements")
    .update({ status: text(form, "status") as Enums<"agreement_status"> })
    .eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath(`/companies/${form.get("company_id")}`);
}
