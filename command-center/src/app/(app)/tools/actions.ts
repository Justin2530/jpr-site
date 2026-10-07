"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { num, text } from "@/lib/format";
import type { Enums } from "@/lib/database.types";

function fields(form: FormData) {
  return {
    name: text(form, "name")!,
    category: text(form, "category") ?? "Other",
    purpose: text(form, "purpose"),
    status: (text(form, "status") ?? "active") as Enums<"service_status">,
    plan: text(form, "plan"),
    billing: (text(form, "billing") ?? "monthly") as Enums<"billing_cycle">,
    cost: num(form, "cost"),
    renews_on: text(form, "renews_on"),
    account_email: text(form, "account_email"),
    login_url: text(form, "login_url"),
    watch: text(form, "watch"),
    notes: text(form, "notes"),
  };
}

export async function saveService(form: FormData) {
  const { supabase } = await requireStaff();
  const id = text(form, "id");
  const { error } = id
    ? await supabase.from("services").update(fields(form)).eq("id", id)
    : await supabase.from("services").insert(fields(form));
  if (error) throw new Error(error.message);
  revalidatePath("/tools");
}

export async function deleteService(form: FormData) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("services").delete().eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath("/tools");
}
