import { NextResponse } from "next/server";
import { webhookDb } from "@/app/api/twilio/webhook";
import { automationSecret, validAutomationSecret } from "@/lib/automation";
import { runLeadsTick } from "@/lib/leads";

export const maxDuration = 300;

// pg_cron knocks here every 2 minutes with the automation secret: run queued Lead Engine searches and read
// new businesses' websites. Kept apart from the automation tick so a long run never holds up texts or calls.
export async function POST(request: Request) {
  if (!validAutomationSecret(request.headers.get("x-jpr-automation"))) return new NextResponse("forbidden", { status: 403 });
  try {
    return NextResponse.json(await runLeadsTick(webhookDb(), automationSecret()!));
  } catch (e) {
    console.error("leads tick failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
