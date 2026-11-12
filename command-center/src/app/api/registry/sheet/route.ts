import { NextResponse } from "next/server";
import { webhookDb } from "@/app/api/twilio/webhook";
import { leadCsv } from "@/lib/lead-csv";

// Feeds Justin's Google Sheet (=IMPORTDATA of this address) so it stays current while the research runs
// (2026-11-12). No login: the random key in ?t= is the lock, checked in the database (7 days from when it was made).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const t = url.searchParams.get("t") ?? "";
  const all = url.searchParams.get("all") === "1";
  const db = webhookDb();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc("lead_registry_export", { p_token: t, p_all: all, p_offset: from, p_limit: 1000 });
    if (error) return new NextResponse("link expired or wrong", { status: 403 });
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return new NextResponse(leadCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
}
