"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { num, text } from "@/lib/format";
import type { Enums } from "@/lib/database.types";

export async function updatePlacement(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const covered = form.get("covered_by_subscription") === "on";
  const compensation = num(form, "compensation");
  const feePercent = covered ? null : num(form, "fee_percent");
  let feeAmount = covered ? 0 : num(form, "fee_amount");
  // Work out the fee from pay and percent when it wasn't typed in.
  if (!covered && feeAmount === null && compensation !== null && feePercent !== null) {
    feeAmount = Math.round(compensation * feePercent) / 100;
  }
  const status = (text(form, "invoice_status") ?? (covered ? "not_applicable" : "not_invoiced")) as Enums<"invoice_status">;
  const { error } = await supabase
    .from("placements")
    .update({
      start_date: text(form, "start_date"),
      compensation,
      fee_percent: feePercent,
      fee_amount: feeAmount,
      covered_by_subscription: covered,
      invoice_status: status,
      invoiced_on: text(form, "invoiced_on") ?? (status === "invoiced" || status === "paid" ? new Date().toISOString().slice(0, 10) : null),
      paid_on: text(form, "paid_on") ?? (status === "paid" ? new Date().toISOString().slice(0, 10) : null),
      guarantee_until: text(form, "guarantee_until"),
      notes: text(form, "notes"),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/placements");
  revalidatePath(`/placements/${id}`);
  revalidatePath("/");
}
