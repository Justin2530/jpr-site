import { NextResponse } from "next/server";
import { getStaff } from "@/lib/staff";
import { LINE_LABEL, sizeBand } from "@/lib/leads-shared";
import type { Enums } from "@/lib/database.types";

// The list as a CSV, ready to import into a campaign tool (ManyReach or another). Only leads with an email
// whose domain takes mail, never active clients, "Do not contact", "Not interested" or customers.
// ?mark=1 also stamps them as exported.
const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Keep spreadsheet apps from treating a cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(request: Request) {
  const { supabase, staff } = await getStaff();
  if (staff?.role !== "owner") return new NextResponse("forbidden", { status: 403 });
  const url = new URL(request.url);
  const line = (url.searchParams.get("line") ?? "local") as Enums<"lead_line">;
  if (!(line in LINE_LABEL)) return new NextResponse("bad line", { status: 400 });
  const likelyOnly = url.searchParams.get("size") === "likely";
  const county = url.searchParams.get("county");

  // A prospect may have become a client since it was found.
  await supabase.rpc("leads_recheck_companies", {});

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from("lead_list_members")
      .select(
        "status, business_id, lead_businesses!inner(name, category, address, city, county, state, zip, phone, website, primary_email, emails, email_status, owner_name, owner_title, size_score, rating, review_count, facebook_url, excluded_reason)",
      )
      .eq("line", line)
      .in("status", ["prospect", "contacted", "replied"])
      .is("lead_businesses.excluded_reason", null)
      .eq("lead_businesses.email_status", "mx_ok")
      .order("created_at")
      .range(from, from + 999);
    if (likelyOnly) q = q.gte("lead_businesses.size_score", 50);
    if (county) q = q.eq("lead_businesses.county", county);
    const { data, error } = await q;
    if (error) return new NextResponse(error.message, { status: 500 });
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const header = ["email", "first_name", "last_name", "company", "owner_title", "phone", "website", "city", "county", "state", "zip", "category", "size_guess", "google_rating", "google_reviews", "other_emails", "facebook", "status", "list"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const b = r.lead_businesses as Record<string, string | number | string[] | null>;
    const [first, ...rest] = String(b.owner_name ?? "").split(" ");
    const others = ((b.emails as string[] | null) ?? []).filter((e) => e !== b.primary_email).join("; ");
    lines.push(
      [b.primary_email, first, rest.join(" "), b.name, b.owner_title, b.phone, b.website, b.city, b.county, b.state, b.zip, b.category,
        sizeBand(Number(b.size_score)).text, b.rating, b.review_count, others, b.facebook_url, r.status, LINE_LABEL[line]]
        .map(csv)
        .join(","),
    );
  }

  if (url.searchParams.get("mark") === "1" && rows.length) {
    const ids = rows.map((r) => r.business_id as string);
    for (let i = 0; i < ids.length; i += 500)
      await supabase.from("lead_list_members").update({ exported_at: new Date().toISOString() }).eq("line", line).in("business_id", ids.slice(i, i + 500));
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${LINE_LABEL[line].replace(/\s+/g, "-")}-leads-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
