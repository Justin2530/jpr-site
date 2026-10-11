import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Justin 2026-10-11: "take everyone off my pipeline that was from the old recruiterflow info... keep the placed
// candidates". Old imports still sitting in Sourced with their switch off come off their jobs; the candidates
// themselves stay on file. Anyone he has since worked (Assigned or further, or on automation) is left alone.
export async function oldImportLinks(supabase: SupabaseClient<Database>) {
  const { data } = await supabase
    .from("candidate_jobs")
    .select("id, candidates!inner(notes)")
    .eq("stage", "sourced")
    .eq("automate", false)
    .ilike("candidates.notes", "%Recruiterflow%");
  return (data ?? []).map((r) => r.id);
}
