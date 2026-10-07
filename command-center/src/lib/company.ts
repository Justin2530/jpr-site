import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Turns the typed company name into a company id, creating a prospect if it's new.
export async function resolveCompany(
  supabase: SupabaseClient<Database>,
  form: FormData,
  opts: { userId: string; marketId: string },
): Promise<{ id: string; market_id: string }> {
  const name = String(form.get("company_name") ?? "").trim();
  if (!name) throw new Error("Enter a company name.");
  const { data: existing } = await supabase.from("companies").select("id, market_id").ilike("name", name.replace(/[%_]/g, "\\$&")).limit(1);
  if (existing?.[0]) return existing[0];
  const { data, error } = await supabase
    .from("companies")
    .insert({ name, status: "prospect", market_id: opts.marketId, created_by: opts.userId })
    .select("id, market_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
