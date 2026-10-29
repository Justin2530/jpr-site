"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { parseHiringRequest } from "./parse";

// A website hiring request that's real: one company (an existing one when the name or the person's email
// matches) and the person as its contact, both linked to the request so it's one record.
export async function addLeadToCompanies(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  const id = String(form.get("id"));
  const { data: item, error } = await supabase.from("action_items").select("id, title, detail, company_id, contact_id").eq("id", id).single();
  if (error || !item) throw new Error(error?.message ?? "Lead not found.");
  if (item.company_id) redirect(`/companies/${item.company_id}`);
  const lead = parseHiringRequest(item.title, item.detail);

  let contact: { id: string; company_id: string | null } | null = null;
  if (lead.email) {
    const { data } = await supabase.from("contacts").select("id, company_id").ilike("email", lead.email).limit(1).maybeSingle();
    contact = data;
  }
  let companyId = contact?.company_id ?? null;
  if (!companyId && lead.company) {
    const { data } = await supabase.from("companies").select("id").ilike("name", lead.company).limit(1).maybeSingle();
    companyId = data?.id ?? null;
  }
  if (!companyId) {
    const market = markets.find((m) => m.slug === "punxsutawney") ?? markets[0];
    const { data: c, error: e1 } = await supabase
      .from("companies")
      .insert({
        market_id: market.id,
        name: lead.company || lead.name,
        status: "prospect",
        notes: [
          `From the website${lead.nationwide ? " (nationwide manufacturing page)" : ""}, ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}.`,
          lead.position && `Hiring for: ${lead.position}.`,
          lead.location && `Location: ${lead.location}.`,
          lead.message,
        ]
          .filter(Boolean)
          .join(" "),
        created_by: userId,
      })
      .select("id")
      .single();
    if (e1) throw new Error(e1.message);
    companyId = c.id;
  }
  if (!contact) {
    const { data: p, error: e2 } = await supabase
      .from("contacts")
      .insert({ company_id: companyId, full_name: lead.name, email: lead.email, phone: lead.phone })
      .select("id, company_id")
      .single();
    if (e2) throw new Error(e2.message);
    contact = p;
  }
  // Handled: it's a company now, so it comes off What needs me.
  const { error: e3 } = await supabase
    .from("action_items")
    .update({ company_id: companyId, contact_id: contact.id, status: "done", resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq("id", id);
  if (e3) throw new Error(e3.message);
  revalidatePath("/inbound");
  revalidatePath("/");
  redirect(`/companies/${companyId}`);
}

// Not a lead (a salesperson, spam, a duplicate): off the list and off What needs me. It stays under Handled.
export async function dismissLead(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const { error } = await supabase
    .from("action_items")
    .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath("/inbound");
  revalidatePath("/");
}

// Back to New, for one dismissed by mistake.
export async function reopenLead(form: FormData) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("action_items")
    .update({ status: "open", resolved_at: null, resolved_by: null })
    .eq("id", String(form.get("id")))
    .is("company_id", null);
  if (error) throw new Error(error.message);
  revalidatePath("/inbound");
  revalidatePath("/");
}
