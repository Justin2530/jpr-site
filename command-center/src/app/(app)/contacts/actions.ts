"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { text } from "@/lib/format";

function fields(form: FormData) {
  return {
    company_id: text(form, "company_id")!,
    full_name: text(form, "full_name")!,
    title: text(form, "title"),
    email: text(form, "email")?.toLowerCase() ?? null,
    phone: text(form, "phone"),
    notes: text(form, "notes"),
  };
}

export async function createContactRecord(form: FormData) {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.from("contacts").insert(fields(form)).select("id").single();
  if (error) throw new Error(error.message);
  redirect(`/contacts/${data.id}`);
}

export async function updateContact(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const { error } = await supabase.from("contacts").update(fields(form)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/contacts/${id}`);
}

export async function removeContact(form: FormData) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("contacts").delete().eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  redirect("/contacts");
}
