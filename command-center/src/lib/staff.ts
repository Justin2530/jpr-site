import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The signed-in staff member and the markets they can see. Cached per request.
export const getStaff = cache(async () => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: staff }, { data: markets }] = await Promise.all([
    supabase.from("staff").select("*").eq("id", userId).maybeSingle(),
    supabase.from("markets").select("id, name, slug").order("name"),
  ]);

  return { supabase, userId, email: claims?.claims?.email as string | undefined, staff, markets: markets ?? [] };
});

// Pages that need a staff record call this; everyone else sees the no-access screen.
export async function requireStaff() {
  const ctx = await getStaff();
  if (!ctx.staff) redirect("/no-access");
  return { ...ctx, staff: ctx.staff };
}
