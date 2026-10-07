import { NextResponse } from "next/server";
import { automationSecret } from "@/lib/automation";
import { hangupCall, validRunSig, type CallContext } from "@/lib/live";
import { update } from "@/lib/screening";
import { webhookDb } from "@/app/api/twilio/webhook";

export const maxDuration = 30;

// A tiny MCP server with one tool, end_call, so the voice assistant can hang up when the call is done.
// Each call gets its own signed address; nothing else is reachable here.
const TOOLS = [
  {
    name: "end_call",
    description: "Hang up the screening call after saying goodbye. Use once, when the call is over.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["interested", "not_interested", "callback", "declined_recording", "wrong_person", "incomplete"],
        },
        note: { type: "string", description: "One short line on how the call ended, including any callback time they gave." },
      },
      required: ["outcome", "note"],
    },
  },
];

const reply = (id: unknown, result: unknown) => NextResponse.json({ jsonrpc: "2.0", id, result });

export async function POST(request: Request) {
  const url = new URL(request.url);
  const run = url.searchParams.get("run") ?? "";
  if (!validRunSig(run, url.searchParams.get("sig"))) return new NextResponse("forbidden", { status: 403 });
  const msg = (await request.json().catch(() => null)) as { id?: unknown; method?: string; params?: Record<string, unknown> } | null;
  if (!msg?.method) return new NextResponse("bad request", { status: 400 });
  if (msg.id === undefined) return new NextResponse(null, { status: 202 }); // notifications

  switch (msg.method) {
    case "initialize":
      return reply(msg.id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "jpr-call", version: "1.0.0" },
      });
    case "ping":
      return reply(msg.id, {});
    case "tools/list":
      return reply(msg.id, { tools: TOOLS });
    case "tools/call": {
      if (msg.params?.name !== "end_call") return reply(msg.id, { isError: true, content: [{ type: "text", text: "Unknown tool" }] });
      const args = (msg.params?.arguments ?? {}) as { outcome?: string; note?: string };
      const db = webhookDb();
      const secret = automationSecret()!;
      const { data } = await db.rpc("screening_get", { p_secret: secret, p_run: run });
      const ctx = data as unknown as CallContext | null;
      await update(db, secret, run, { call_outcome: args.outcome ?? "incomplete", outcome_note: args.note ?? "" });
      if (ctx?.live_session_id) {
        // Give the goodbye a moment to finish playing before hanging up.
        await new Promise((r) => setTimeout(r, 2500));
        await hangupCall(ctx.live_session_id).catch((e) => console.error("hangup failed", e));
      }
      return reply(msg.id, { content: [{ type: "text", text: "Call ended." }] });
    }
    default:
      return NextResponse.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
}

export async function GET() {
  return new NextResponse("method not allowed", { status: 405 });
}
