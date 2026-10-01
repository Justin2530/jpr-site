"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { googleReady } from "@/lib/google";
import { syncGmail } from "@/lib/gmail-sync";

// Called quietly by the app while it's open. Checks Gmail at most once a minute.
export async function checkEmail(): Promise<number> {
  if (!googleReady()) return 0;
  const { supabase, userId } = await requireStaff();
  const { data: account } = await supabase.from("google_accounts").select("last_synced_at").eq("staff_id", userId).maybeSingle();
  if (!account) return 0;
  if (account.last_synced_at && Date.now() - new Date(account.last_synced_at).getTime() < 60_000) return 0;
  try {
    const added = await syncGmail(supabase, userId);
    if (added) revalidatePath("/", "layout");
    return added;
  } catch (e) {
    console.error("Gmail sync failed", e);
    return 0;
  }
}
