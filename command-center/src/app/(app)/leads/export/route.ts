import { NextResponse } from "next/server";
import { getStaff } from "@/lib/staff";
import { LINE_LABEL, sizeBand } from "@/lib/leads-shared";
import type { Enums } from "@/lib/database.types";

// The filtered list as a CSV for a campaign tool (ManyReach or another), with WellThree's columns plus owner
// names. Only emails that passed the check (Bouncer "deliverable", or until Bouncer is on, a domain that takes
// mail); never active clients, customers, "Not interested" or "Do not contact". ?mark=1 stamps them exported,
// with ?campaign= as the campaign name.
const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Keep spreadsheet apps from treating a cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

type Biz = Record<string, string | number | string[] | null>;

export async function GET(request: Request) {
  const { supabase, staff } = await getStaff();
  if (staff?.role !== "owner") return new NextResponse("forbidden", { status: 403 });
  const url = new URL(request.url);
  const p = url.searchParams;
  const line = (p.get("line") ?? "local") as Enums<"lead_line">;
  if (!(line in LINE_LABEL)) return new NextResponse("bad line", { status: 400 });
  const campaign = p.get("campaign")?.trim().slice(0, 120) || null;
  const hasBouncer = !!process.env.BOUNCER_API_KEY?.trim();

  // A prospect may have become a client since it was found.
  await supabase.rpc("leads_recheck_companies", {});

  const statuses = (["prospect", "contacted", "replied"] as const).filter((s) => !p.get("status") || p.get("status") === "all" || p.get("status") === s);
  const rows: { status: string; business_id: string; exported_at: string | null; campaign: string | null; lead_businesses: Biz }[] = [];
  for (let from = 0; statuses.length; from += 1000) {
    let q = supabase
      .from("lead_list_members")
      .select(
        "status, business_id, exported_at, campaign, lead_businesses!inner(name, category, address, city, county, state, zip, phone, website, domain, facebook_url, primary_email, email_source, emails, email_status, email_verification, owner_name, owner_title, size_score, rating, review_count, created_at, enriched_at, excluded_reason)",
      )
      .eq("line", line)
      .in("status", statuses)
      .is("lead_businesses.excluded_reason", null)
      .order("created_at")
      .range(from, from + 999);
    q = hasBouncer ? q.eq("lead_businesses.email_verification", "deliverable") : q.eq("lead_businesses.email_status", "mx_ok");
    const size = p.get("size");
    if (size === "high") q = q.gte("lead_businesses.size_score", 50);
    if (size === "medium") q = q.gte("lead_businesses.size_score", 30).lt("lead_businesses.size_score", 50);
    if (size === "low") q = q.lt("lead_businesses.size_score", 30);
    if (p.get("state")) q = q.eq("lead_businesses.state", p.get("state")!);
    if (p.get("trade")) q = q.eq("lead_businesses.category", p.get("trade")!);
    if (p.get("exported") === "yes") q = q.not("exported_at", "is", null);
    if (p.get("exported") === "no") q = q.is("exported_at", null);
    const text = p.get("q")?.replace(/[%_,()*]/g, " ").trim();
    if (text) q = q.or(`name.ilike.%${text}%,website.ilike.%${text}%,phone.ilike.%${text}%,primary_email.ilike.%${text}%`, { referencedTable: "lead_businesses" });
    const { data, error } = await q;
    if (error) return new NextResponse(error.message, { status: 500 });
    rows.push(...((data ?? []) as unknown as typeof rows));
    if ((data ?? []).length < 1000) break;
  }

  const now = new Date().toISOString();
  const mark = p.get("mark") === "1";
  const header = [
    "business_name", "category", "city", "state", "website_domain", "phone", "facebook_url", "primary_email", "primary_email_source",
    "primary_email_verification", "google_rating", "review_count", "date_discovered", "last_enriched_date", "exported_to_manyreach",
    "date_exported", "campaign", "customer_status", "first_name", "last_name", "owner_title", "county", "zip", "address", "website",
    "size_guess", "other_emails", "list",
  ];
  const lines = [header.join(",")];
  // Never the same inbox twice (two listings of one business, or a shared office email).
  const seen = new Set<string>();
  for (const r of rows) {
    const b = r.lead_businesses;
    const email = String(b.primary_email ?? "").toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const [first, ...rest] = String(b.owner_name ?? "").split(" ");
    const others = ((b.emails as string[] | null) ?? []).filter((e) => e !== b.primary_email).join("; ");
    const exportedAt = mark ? now : r.exported_at;
    lines.push(
      [
        b.name, b.category, b.city, b.state, b.domain, b.phone, b.facebook_url, b.primary_email, b.email_source,
        b.email_verification ?? (b.email_status === "mx_ok" ? "domain ok" : ""), b.rating, b.review_count,
        String(b.created_at ?? "").slice(0, 10), String(b.enriched_at ?? "").slice(0, 10), exportedAt ? "yes" : "no",
        String(exportedAt ?? "").slice(0, 10), (mark ? campaign : null) ?? r.campaign, r.status, first, rest.join(" "), b.owner_title,
        b.county, b.zip, b.address, b.website, sizeBand(Number(b.size_score)).text, others, LINE_LABEL[line],
      ]
        .map(csv)
        .join(","),
    );
  }

  // Repeats are stamped too: their inbox went out in this file.
  if (mark && rows.length) {
    const ids = rows.map((r) => r.business_id);
    for (let i = 0; i < ids.length; i += 500)
      await supabase
        .from("lead_list_members")
        .update({ exported_at: now, ...(campaign ? { campaign } : {}) })
        .eq("line", line)
        .in("business_id", ids.slice(i, i + 500));
  }

  const date = now.slice(0, 10);
  const name = `${LINE_LABEL[line].replace(/\s+/g, "-")}-${campaign ? campaign.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40) + "-" : ""}leads-${date}.csv`;
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
