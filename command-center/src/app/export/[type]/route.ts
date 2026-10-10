import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const QUERIES: Record<string, { table: string; select: string }> = {
  candidates: { table: "candidates", select: "full_name, phone, email, current_title, current_employer, city, state, source, contact_consent, notes, created_at" },
  jobs: { table: "jobs", select: "title, status, priority, location, compensation, schedule, opened_on, companies(name)" },
  pipeline: { table: "candidate_jobs", select: "stage, assigned_at, stage_changed_at, candidates(full_name), jobs(title, companies(name))" },
  placements: {
    table: "placements",
    select: "start_date, compensation, fee_percent, fee_amount, covered_by_subscription, invoice_status, invoiced_on, paid_on, guarantee_until, candidate_jobs(candidates(full_name), jobs(title, companies(name)))",
  },
  companies: { table: "companies", select: "name, status, industry, city, phone, website, created_at" },
  contacts: { table: "contacts", select: "full_name, title, phone, email, companies!contacts_company_id_fkey(name)" },
  deals: { table: "deals", select: "title, stage, deal_type, value, expected_close, next_step, next_step_on, closed_at, companies(name)" },
};

// Flatten nested objects (e.g. companies.name) into columns.
function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  return Object.entries(obj ?? {}).reduce<Record<string, unknown>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(acc, flatten(v as Record<string, unknown>, key));
    else acc[key] = v;
    return acc;
  }, {});
}

function csvCell(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const q = QUERIES[type];
  if (!q) return new NextResponse("Unknown export", { status: 404 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return new NextResponse("Sign in first", { status: 401 });

  const { data, error } = await supabase.from(q.table as "candidates").select(q.select).limit(10000);
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []).map((r) => flatten(r as unknown as Record<string, unknown>));
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="jpr-${type}-${date}.csv"`,
    },
  });
}
