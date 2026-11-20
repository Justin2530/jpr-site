import { NextResponse } from "next/server";
import { validAutomationSecret } from "@/lib/automation";

export const maxDuration = 300;

// Hunter.io emails for the master lead list (Justin, 2026-11-20; no Command Center screens). Automation secret only.
// {"account": true} shows the plan and credits left; {"domains": [...]} runs one Domain Search per domain (about one
// credit each when it finds something) and returns what Hunter knows: emails with names, titles and confidence.
const API = "https://api.hunter.io/v2";

type Email = { value: string; type: string; confidence: number; first_name: string | null; last_name: string | null; position: string | null; department: string | null; seniority: string | null };

async function hunter(path: string, params: Record<string, string>) {
  const key = process.env.HUNTER_API_KEY;
  if (!key) throw new Error("HUNTER_API_KEY is not set");
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { "X-API-KEY": key }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: { details?: string }[] };
  if (!res.ok) throw new Error(json.errors?.[0]?.details ?? `Hunter ${res.status}`);
  return json.data ?? {};
}

export async function POST(request: Request) {
  if (!validAutomationSecret(request.headers.get("x-jpr-automation"))) return new NextResponse("forbidden", { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { account?: boolean; domains?: string[] };
  try {
    if (body.account) {
      const a = await hunter("account", {});
      return NextResponse.json({ plan: a.plan_name, requests: a.requests, reset: a.reset_date });
    }
    const out = [];
    for (const domain of (body.domains ?? []).slice(0, 60)) {
      try {
        const d = await hunter("domain-search", { domain, limit: "10" });
        const emails = ((d.emails ?? []) as Email[]).map((e) => ({
          email: e.value, type: e.type, confidence: e.confidence,
          name: [e.first_name, e.last_name].filter(Boolean).join(" ") || null, title: e.position, seniority: e.seniority,
        }));
        out.push({ domain, organization: d.organization ?? null, pattern: d.pattern ?? null, emails });
      } catch (e) {
        out.push({ domain, error: e instanceof Error ? e.message : "failed" });
        if (e instanceof Error && /usage limit|quota|credits/i.test(e.message)) break;
      }
    }
    return NextResponse.json({ results: out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
