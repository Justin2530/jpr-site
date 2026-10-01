import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { registerAutomation } from "@/lib/automation";

// Start screening outreach for a candidate a person just assigned to a job. Only the assign actions
// call this, so imports and other automation never start outreach.
export async function beginOutreach(supabase: SupabaseClient<Database>, candidateJobId: string, owner: boolean) {
  const { error } = await supabase.rpc("start_pursuit", { p_candidate_job_id: candidateJobId });
  if (error) console.error("start_pursuit failed", error.message);
  if (owner) {
    const h = await headers();
    await registerAutomation(supabase, `https://${h.get("x-forwarded-host") ?? h.get("host")}`);
  }
}
