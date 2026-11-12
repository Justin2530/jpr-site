import { NextResponse } from "next/server";
import { getStaff } from "@/lib/staff";

// Justin's download of the master lead list so far (2026-11-12): every researched business that looks like 4+
// employees, as a CSV that opens in Google Sheets. Owner only; there's no screen for it in the Command Center.
// ?all=1 includes every researched business, not only 4+.
type P = { name: string; title: string | null };

const COLS = [
  "Business", "County", "City", "Address", "Phone", "Website", "Email", "Other emails", "Est. employees", "Size",
  "What they do", "Category", "Registry contact", "Registry title", "People on website", "Hiring", "Careers page",
  "Facebook", "Google rating", "Reviews", "PPP jobs", "Entity type", "Registered", "Confidence", "Why", "Filing #",
];

function cell(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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
  const lines = [COLS.join(",")];
  for (const r of rows) {
    const x = (r.research ?? {}) as Record<string, unknown>;
    const people = Array.isArray(x.people) ? (x.people as P[]).map((p) => (p.title ? `${p.name} (${p.title})` : p.name)).join("; ") : "";
    const emails = Array.isArray(r.emails) ? (r.emails as string[]).filter((e) => e !== r.email).join("; ") : "";
    lines.push(
      [
        r.name, r.county, r.city, r.maps_address ?? r.address, r.phone, r.website, r.email, emails, r.employees_est, r.size_guess,
        x.what_they_do, r.category, r.contact, r.contact_title, people, x.hiring === true ? "Yes" : x.hiring === false ? "No" : "",
        x.careers_url, x.facebook, r.rating, r.reviews, r.ppp_jobs, r.entity_type, r.registered_on, x.confidence, x.evidence, r.filing,
      ]
        .map(cell)
        .join(","),
    );
  }
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="JPR Local leads ${all ? "all researched" : "4+"} ${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
