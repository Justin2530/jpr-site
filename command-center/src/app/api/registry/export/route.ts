import { NextResponse } from "next/server";
import { getStaff } from "@/lib/staff";
import { leadCsv } from "@/lib/lead-csv";

// Justin's download of the master lead list so far (2026-11-12): every researched business that looks like 4+
// employees, as a CSV that opens in Google Sheets. Owner only; there's no screen for it in the Command Center.
// ?all=1 includes every researched business, not only 4+.
export async function GET(request: Request) {
  const { supabase, staff } = await getStaff();
  if (!staff || staff.role !== "owner") return new NextResponse("forbidden", { status: 403 });
  const all = new URL(request.url).searchParams.get("all") === "1";
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from("lead_registry")
      .select("*")
      .is("removed_reason", null)
      .not("researched_at", "is", null)
      .order("employees_est", { ascending: false, nullsFirst: false })
      .order("name")
      .range(from, from + 999);
    if (!all) q = q.eq("size_guess", "4+").or("closed.is.null,closed.eq.false");
    const { data, error } = await q;
    if (error) return new NextResponse(error.message, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse("\uFEFF" + leadCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="JPR Local leads ${all ? "all researched" : "4+"} ${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
