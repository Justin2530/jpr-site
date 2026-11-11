"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { text } from "@/lib/format";
import { AGENTS } from "@/lib/agents";

export async function renameAgent(form: FormData) {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") throw new Error("Only the owner can rename agents.");
  const key = text(form, "key");
  const name = text(form, "name");
  if (!key || !AGENTS.some((a) => a.key === key) || !name) return;
  const { error } = await supabase.from("agent_names").upsert({ key, name: name.slice(0, 40), updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  revalidatePath("/agents");
}
