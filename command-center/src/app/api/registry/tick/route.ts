import { NextResponse } from "next/server";
import { webhookDb } from "@/app/api/twilio/webhook";
import { automationSecret, validAutomationSecret } from "@/lib/automation";
import { researchOne, runRegistryTick, serp } from "@/lib/registry-research";

export const maxDuration = 300;

// Background research for the PA registry list (no Command Center screens). pg_cron knocks here with the
// automation secret while the job runs. {"test": "<search>"} returns one raw Google result, and
// {"one": {name, city, county}} researches one business without saving, for checking the agent.
export async function POST(request: Request) {
  if (!validAutomationSecret(request.headers.get("x-jpr-automation"))) return new NextResponse("forbidden", { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { test?: string; one?: { name: string; city?: string; county?: string } };
  const db = webhookDb();
  try {
    const key = process.env.BRIGHTDATA_API_KEY?.trim();
    if (body.test) return NextResponse.json(await serp(key!, body.test));
    if (body.one) {
      const row = { filing: "test", entity_type: null, registered_on: null, address: null, contact: null, ppp_jobs: null, plan_people: null, city: null, county: null, ...body.one };
      return NextResponse.json(await researchOne(key!, row as Parameters<typeof researchOne>[1]));
    }
    return NextResponse.json(await runRegistryTick(db, automationSecret()!));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
