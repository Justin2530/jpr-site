"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";

export async function resolveTask(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const id = String(form.get("id"));
  const status = form.get("status") === "dismissed" ? "dismissed" : "done";
  const { error } = await supabase
    .from("action_items")
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function addTask(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  const title = String(form.get("title") ?? "").trim();
  if (!title) return;
  const { error } = await supabase.from("action_items").insert({
    title,
    kind: "task",
    priority: 2,
    created_by: userId,
    market_id: markets[0]?.id ?? null,
    due_on: (form.get("due_on") as string) || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

// Removes the placeholder records loaded for the preview. Owner only.
export async function clearSampleData() {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") throw new Error("Only the owner can clear sample data.");
  const { data: companies } = await supabase.from("companies").select("id").eq("is_sample", true);
  const ids = (companies ?? []).map((c) => c.id);
  if (ids.length) {
    const jobs = await supabase.from("jobs").delete().in("company_id", ids);
    if (jobs.error) throw new Error(jobs.error.message);
  }
  const cands = await supabase.from("candidates").delete().eq("is_sample", true);
  if (cands.error) throw new Error(cands.error.message);
  if (ids.length) {
    const cos = await supabase.from("companies").delete().in("id", ids);
    if (cos.error) throw new Error(cos.error.message);
  }
  await supabase.from("action_items").delete().eq("detail", "Sample reminder");
  revalidatePath("/", "layout");
}
