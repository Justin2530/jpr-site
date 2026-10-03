import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// The master Automated recruiting switch, and whether a candidate is new enough to ever be automated.
export async function automationState(supabase: SupabaseClient<Database>) {
  const { data } = await supabase.from("automation_settings").select("automated_recruiting, eligible_after").maybeSingle();
  const on = Boolean(data?.automated_recruiting);
  const after = data?.eligible_after ?? null;
  return {
    on,
    eligibleAfter: after,
    eligible: (createdAt: string) => Boolean(after) && new Date(createdAt) >= new Date(after!),
  };
}
