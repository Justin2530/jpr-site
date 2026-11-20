import { NextResponse } from "next/server";
import { webhookDb } from "@/app/api/twilio/webhook";
import { automationSecret, validAutomationSecret } from "@/lib/automation";
import { fbSample, findPageDebug, runRegistryFacebook } from "@/lib/registry-facebook";

export const maxDuration = 300;

// Facebook emails for the master lead list (no Command Center screens). pg_cron knocks here with the automation
// secret while the job runs. {"pages": n, "searches": n} limits one run (a test; 0 skips that step);
// {"sample": "<snapshot id>"} shows the first records of a finished scraper job; {"find": {name, city, county},
// "engine": "google" | "bing"} shows how the page search reads one business.
export async function POST(request: Request) {
  if (!validAutomationSecret(request.headers.get("x-jpr-automation"))) return new NextResponse("forbidden", { status: 403 });
  const body = (await request.json().catch(() => ({}))) as {
    pages?: number; searches?: number; seconds?: number; sample?: string;
    find?: { name: string; city?: string | null; county?: string | null }; engine?: "google" | "bing";
  };
  try {
    if (body.sample) return NextResponse.json(await fbSample(body.sample));
    if (body.find) return NextResponse.json(await findPageDebug({ city: null, county: null, ...body.find }, body.engine ?? "google"));
    return NextResponse.json(await runRegistryFacebook(webhookDb(), automationSecret()!, body));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
