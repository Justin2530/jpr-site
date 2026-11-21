import { NextResponse } from "next/server";
import { webhookDb } from "@/app/api/twilio/webhook";
import { automationSecret, validAutomationSecret } from "@/lib/automation";
import { runEmailSearch } from "@/lib/registry-emailsearch";

export const maxDuration = 300;

// Second email pass for the master lead list (no Command Center screens). pg_cron knocks here with the automation
// secret while the job runs; {"limit": n} runs a small test.
export async function POST(request: Request) {
  if (!validAutomationSecret(request.headers.get("x-jpr-automation"))) return new NextResponse("forbidden", { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { limit?: number; seconds?: number };
  try {
    return NextResponse.json(await runEmailSearch(webhookDb(), automationSecret()!, body));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
