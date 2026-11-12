"use server";

import { headers } from "next/headers";
import { requireStaff } from "@/lib/staff";
import { automationSecret } from "@/lib/automation";
import { handle, type Pending } from "@/lib/jarvis";
import { webhookDb } from "@/app/api/twilio/webhook";

export type JarvisLine = { at: string; role: "jp" | "jarvis"; channel: string; content: string };

async function owner() {
  const { staff } = await requireStaff();
  if (staff.role !== "owner") throw new Error("Only the owner can talk to Jarvis.");
  const secret = automationSecret();
  if (!secret || !process.env.OPENAI_API_KEY?.trim()) throw new Error("Jarvis isn't set up yet.");
  return { db: webhookDb(), secret };
}

// J. P. typed or said something in the Jarvis panel. "confirm" or the Confirm button runs what's waiting.
export async function askJarvis(said: string): Promise<{ reply: string; pending: Pending | null }> {
  const { db, secret } = await owner();
  const text = said.trim().slice(0, 4000);
  if (!text) return { reply: "", pending: null };
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  try {
    const turn = await handle(db, secret, "app", text, origin);
    return { reply: turn.reply, pending: turn.pending };
  } catch (e) {
    console.error("Jarvis (app) failed", e);
    return { reply: `Something went wrong on my end: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`, pending: null };
  }
}

export async function jarvisState(): Promise<{ lines: JarvisLine[]; pending: Pending | null }> {
  const { db, secret } = await owner();
  const rpc = db.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown }>;
  const [{ data: lines }, { data: pending }] = await Promise.all([
    rpc("jarvis_recent", { p_secret: secret, p_limit: 60 }),
    rpc("jarvis_pending", { p_secret: secret }),
  ]);
  return { lines: (lines as JarvisLine[] | null) ?? [], pending: (pending as Pending | null) ?? null };
}
