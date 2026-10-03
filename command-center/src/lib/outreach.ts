import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { registerAutomation } from "@/lib/automation";

// Turn on screening outreach for one candidate on one job. Only a person's choice calls this (Assign +
// automate, or the switch on the job tab), so imports and other automation never start outreach.
export async function beginOutreach(supabase: SupabaseClient<Database>, candidateJobId: string, owner: boolean, strict = false) {
  const { data, error } = await supabase.rpc("set_outreach", { p_candidate_job_id: candidateJobId, p_on: true });
  if (error) {
    if (strict) throw new Error(error.message);
    console.error("set_outreach failed", error.message);
  }
  if (owner) {
    const h = await headers();
    await registerAutomation(supabase, `https://${h.get("x-forwarded-host") ?? h.get("host")}`);
  }
  return data;
}
