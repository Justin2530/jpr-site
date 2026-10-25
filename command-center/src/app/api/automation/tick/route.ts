import { NextResponse } from "next/server";
import { webhookDb } from "@/app/api/twilio/webhook";
import { runTick, validAutomationSecret } from "@/lib/automation";

export const maxDuration = 300;

// pg_cron knocks here every minute with the automation secret: send what's due, check Gmail.
export async function POST(request: Request) {
  if (!validAutomationSecret(request.headers.get("x-jpr-automation"))) return new NextResponse("forbidden", { status: 403 });
  const url = new URL(request.url);
  const origin = `https://${request.headers.get("x-forwarded-host") ?? url.host}`;
  try {
    return NextResponse.json(await runTick(webhookDb(), origin));
  } catch (e) {
    console.error("automation tick failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
