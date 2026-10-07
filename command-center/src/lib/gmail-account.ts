import { cache } from "react";
import { getStaff } from "@/lib/staff";
import { googleReady } from "@/lib/google";

// The signed-in staff member's connected Gmail address, or null. Cached per request.
export const gmailAccount = cache(async () => {
  if (!googleReady()) return null;
  const { supabase, userId } = await getStaff();
  const { data } = await supabase.from("google_accounts").select("email, connected_at").eq("staff_id", userId).maybeSingle();
  return data;
});
