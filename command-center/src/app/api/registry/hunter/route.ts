import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import { webhookDb } from "@/app/api/twilio/webhook";
import { automationSecret, validAutomationSecret } from "@/lib/automation";

export const maxDuration = 300;

// Hunter.io emails for the master lead list (Justin, 2026-11-20; no Command Center screens). Automation secret only.
// {"account": true} shows the plan and credits left; {"domains": [...]} runs one Domain Search per domain and returns
// what Hunter knows (a test). Anything else is a pg_cron tick: it works through lead_registry_hunter, one Domain Search
// per Sheet company website (1 credit when Hunter finds emails, none when it doesn't), and stops when credits run out.
const API = "https://api.hunter.io/v2";

type Email = { value: string; type: string; confidence: number; first_name: string | null; last_name: string | null; position: string | null; department: string | null; seniority: string | null };

const TICK = 120;

// A queue key "acme.com#hr" searches one department (hr, operations, management...): a domain search returns at most
// 10 people, so big companies get extra searches aimed at the people Justin wants there (2026-11-21).
async function search(key: string) {
  const [domain, department] = key.split("#");
  const d = await hunter("domain-search", { domain, limit: "10", ...(department ? { department } : {}) });
  const emails = ((d.emails ?? []) as Email[]).map((e) => ({
    email: e.value, type: e.type, confidence: e.confidence,
    name: [e.first_name, e.last_name].filter(Boolean).join(" ") || null, title: e.position, seniority: e.seniority,
  }));
  return { domain, organization: (d.organization as string | null) ?? null, pattern: (d.pattern as string | null) ?? null, emails };
}

// Out of credits or throttled: stop the tick and leave the domain for later.
const stopper = (m: string) => /usage limit|quota|credits|too many requests|rate limit|429/i.test(m);

async function tick() {
  const db = webhookDb();
  const secret = automationSecret()!;
  const { data: claimed, error } = await db.rpc("lead_registry_hunter_claim", { p_secret: secret, p_limit: TICK });
  if (error) throw new Error(error.message);
  let found = 0, empty = 0, failed = 0, stopped: string | null = null;
  for (const { domain } of claimed ?? []) {
    const save = (p_status: string, r: { emails?: unknown; organization?: string | null; pattern?: string | null } = {}, p_error: string | null = null) =>
      db.rpc("lead_registry_hunter_save", {
        p_secret: secret, p_domain: domain, p_status, p_emails: (r.emails ?? []) as Json,
        p_organization: r.organization ?? null, p_pattern: r.pattern ?? null, p_error,
      });
    if (stopped) { await save("pending"); continue; }
    try {
      const r = await search(domain);
      await save("done", r);
      if (r.emails.length) found++; else empty++;
    } catch (e) {
      const m = e instanceof Error ? e.message : "failed";
      if (stopper(m)) { stopped = m; await save("pending"); continue; }
      await save("failed", {}, m);
      failed++;
    }
  }
  return { claimed: claimed?.length ?? 0, found, empty, failed, stopped };
}

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
    if (!body.domains) return NextResponse.json(await tick());
    const out = [];
    for (const domain of body.domains.slice(0, 60)) {
      try {
        out.push(await search(domain));
      } catch (e) {
        out.push({ domain, error: e instanceof Error ? e.message : "failed" });
        if (e instanceof Error && stopper(e.message)) break;
      }
    }
    return NextResponse.json({ results: out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
