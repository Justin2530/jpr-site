import { logger, task } from "@trigger.dev/sdk";
import WebSocket from "ws";

// Stays on one AI screening call through OpenAI's sideband connection and hangs up when the call is
// over: a few seconds after the assistant says goodbye and the candidate has nothing more to say, or
// after a long stretch of dead air. OpenAI can't end a phone call on its own.
// Needs OPENAI_API_KEY in Trigger.dev's environment variables.

const API = "https://api.openai.com/v1";
const GOODBYE = /\b(bye|goodbye|take care|have a (good|great|nice))\b/i;
const AFTER_GOODBYE_MS = 5_000; // quiet time after the goodbye before hanging up
const DEAD_AIR_MS = 45_000; // nobody has said anything for this long
const MAX_CALL_MS = 16 * 60_000; // Twilio cuts calls at 15 minutes anyway

export type CallWatchPayload = { sessionId: string; runId: string };

// Pull any spoken text out of a transcript event, whatever the field is called.
function textOf(e: Record<string, unknown>) {
  for (const k of ["delta", "transcript", "text"]) if (typeof e[k] === "string") return e[k] as string;
  return "";
}

export const callWatch = task({
  id: "screening-call-watch",
  maxDuration: 1200,
  run: async ({ sessionId, runId }: CallWatchPayload) => {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error("OPENAI_API_KEY isn't set in Trigger.dev");

    const ws = new WebSocket(`wss://api.openai.com/v1/live/sessions/${sessionId}/attach`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    const seen = new Map<string, number>();
    let lastActivity = Date.now();
    let goodbyeAt: number | null = null;
    let agentSinceCandidate = "";
    let reason = "";

    const hangup = async (why: string) => {
      if (reason) return;
      reason = why;
      logger.info("Hanging up", { runId, why });
      const res = await fetch(`${API}/live/sessions/${sessionId}/hangup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok && res.status !== 404) logger.warn("Hangup failed", { status: res.status, body: (await res.text()).slice(0, 300) });
      ws.close();
    };

    await new Promise<void>((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const now = Date.now();
        if (goodbyeAt && now - lastActivity > AFTER_GOODBYE_MS) void hangup("assistant said goodbye");
        else if (now - lastActivity > DEAD_AIR_MS) void hangup("dead air");
        else if (now - started > MAX_CALL_MS) void hangup("call ran too long");
      }, 1000);
      const done = () => {
        clearInterval(timer);
        resolve();
      };

      ws.on("open", () => logger.info("Attached to call", { runId, sessionId }));
      ws.on("error", (err) => logger.error("Sideband error", { error: String(err) }));
      ws.on("close", (code, why) => {
        logger.info("Sideband closed", { code, why: why.toString(), events: Object.fromEntries(seen) });
        done();
      });
      ws.on("message", (raw) => {
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const type = String(e.type ?? "unknown");
        // First few of each kind go to the log, to learn the event stream on real calls.
        const n = (seen.get(type) ?? 0) + 1;
        seen.set(type, n);
        if (n <= 2) logger.debug("Event", { type, sample: JSON.stringify(e).slice(0, 600) });

        if (type === "session.closed" || type === "error") {
          if (type === "error") logger.warn("OpenAI error", { e });
          if (type === "session.closed") reason ||= "call ended";
          ws.close();
          return;
        }
        const isInput = /input_transcript|input_audio/.test(type);
        const isOutput = /output_transcript|output_audio/.test(type);
        if (!isInput && !isOutput) return;
        lastActivity = Date.now();
        const text = textOf(e);
        if (isInput && text.trim()) {
          // The candidate spoke: any goodbye so far didn't end the call.
          goodbyeAt = null;
          agentSinceCandidate = "";
        } else if (isOutput && text) {
          agentSinceCandidate += text;
          if (GOODBYE.test(agentSinceCandidate)) goodbyeAt ??= Date.now();
        }
      });
    });

    return { runId, reason: reason || "sideband closed" };
  },
});
