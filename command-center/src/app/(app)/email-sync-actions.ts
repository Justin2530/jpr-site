"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { googleReady } from "@/lib/google";
import { syncMailbox } from "@/lib/gmail-sync";
import { automationSecret } from "@/lib/automation";
import { webhookDb } from "@/app/api/twilio/webhook";

// Called quietly by the app while it's open, on top of the background check. At most once a minute.
export async function checkEmail(): Promise<number> {
  const secret = automationSecret();
  if (!googleReady() || !secret) return 0;
  const { supabase, userId } = await requireStaff();
  const { data: account } = await supabase
    .from("google_accounts")
    .select("email, token_enc, connected_at, last_synced_at")
    .eq("staff_id", userId)
    .maybeSingle();
  if (!account) return 0;
  if (account.last_synced_at && Date.now() - new Date(account.last_synced_at).getTime() < 60_000) return 0;
  try {
    const added = await syncMailbox(webhookDb(), secret, {
      staff_id: userId,
      email: account.email,
      token: account.token_enc,
      connected_at: account.connected_at,
      last_synced_at: account.last_synced_at,
    });
    if (added) revalidatePath("/", "layout");
    return added;
  } catch (e) {
    console.error("Gmail sync failed", e);
    return 0;
  }
}
