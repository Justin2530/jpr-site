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
