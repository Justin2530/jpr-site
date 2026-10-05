import { logger, task } from "@trigger.dev/sdk";
import WebSocket from "ws";

// Stays on one AI screening call through OpenAI's sideband connection and hangs up when the call is
// over: a few seconds after the assistant says goodbye and the candidate has nothing more to say, or
// after a long stretch of dead air. OpenAI can't end a phone call on its own.
// It also answers GPT-Live's hand-offs ("let me note that"), which otherwise leave the assistant
// waiting in silence, and reports what it saw to the run's watch_note so calls can be diagnosed.
// Needs OPENAI_API_KEY in Trigger.dev's environment variables.

const API = "https://api.openai.com/v1";
// The Supabase URL and publishable key are public values; the env copies come from the Vercel sync.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://iobrwlgubowkxyjtxeib.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_xy4ZXbWgeeAP8D0xqhk17w_MFtgUXMy";
const GOODBYE = /\b(bye|goodbye|take care|have a (good|great|nice))\b/i;
// What a candidate says back to a goodbye; it doesn't mean the conversation is still going.
const SIGN_OFF = /\b(bye|goodbye|take care|you too|thanks|thank you|have a|alright|all right|ok|okay|sounds good)\b/i;
const AFTER_GOODBYE_MS = 4_000; // quiet time after the goodbye before hanging up
const DEAD_AIR_MS = 45_000; // nobody has said anything for this long
const MAX_CALL_MS = 16 * 60_000; // Twilio cuts calls at 15 minutes anyway
const HANDOFF_REPLY =
  "Nothing needs to be noted, saved or looked up: the whole call is recorded and Justin gets everything afterward. Answer the candidate right away and carry on with the next question.";

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
    const report = async (note: Record<string, unknown>) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/screening_watch_report`, {
          method: "POST",
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_run: runId, p_session: sessionId, p_note: note }),
        });
        if (!res.ok) logger.warn("Report failed", { status: res.status, body: (await res.text()).slice(0, 300) });
      } catch (e) {
        logger.warn("Report failed", { error: String(e) });
      }
    };
    await report({ watcher: "started", watcher_started_at: new Date().toISOString() });

    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      await report({ watcher: "no OPENAI_API_KEY in Trigger.dev" });
      throw new Error("OPENAI_API_KEY isn't set in Trigger.dev");
    }

    const ws = new WebSocket(`wss://api.openai.com/v1/live/sessions/${sessionId}/attach`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    const seen = new Map<string, number>();
    const samples: Record<string, string> = {};
    let handoffs = 0;
    let lastActivity = Date.now();
    let goodbyeAt: number | null = null;
    let agentSinceCandidate = "";
    let reason = "";
    let hangupResult = "";

    const hangup = async (why: string) => {
      if (reason) return;
      reason = why;
      logger.info("Hanging up", { runId, why });
      const res = await fetch(`${API}/live/sessions/${sessionId}/hangup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
      });
      hangupResult = res.ok ? "ok" : `${res.status} ${(await res.text()).slice(0, 300)}`;
      if (!res.ok && res.status !== 404) logger.warn("Hangup failed", { result: hangupResult });
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

      ws.on("open", () => {
        logger.info("Attached to call", { runId, sessionId });
        void report({ watcher: "attached" });
      });
      ws.on("error", (err) => {
        logger.error("Sideband error", { error: String(err) });
        void report({ watcher_error: String(err).slice(0, 300) });
      });
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
        // Count every kind and keep one sample of each, to learn the event stream on real calls.
        seen.set(type, (seen.get(type) ?? 0) + 1);
        if (!samples[type] && !/audio/.test(type)) samples[type] = JSON.stringify(e).slice(0, 400);

        if (type === "session.closed" || type === "error") {
          if (type === "error") logger.warn("OpenAI error", { e });
          if (type === "session.closed") reason ||= "call ended";
          ws.close();
          return;
        }
        if (type === "session.delegation.created") {
          // GPT-Live handed something off ("let me note that") and waits for an answer; nothing on
          // this call needs a backend, so tell it to carry on.
          const d = e.delegation as { id?: string } | undefined;
          handoffs++;
          if (d?.id && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "session.thinking.append", delegation_id: d.id, content: HANDOFF_REPLY }));
          }
          return;
        }
        // Only words count as activity: the audio streams flow even when nobody is talking.
        const isInput = /input_transcript/.test(type);
        const isOutput = /output_transcript/.test(type);
        if (!isInput && !isOutput) return;
        const text = textOf(e);
        if (!/[a-z]{2}/i.test(text)) return;
        lastActivity = Date.now();
        if (isInput) {
          // The candidate kept talking: an earlier goodbye didn't end the call. A sign-off back doesn't count.
          if (!SIGN_OFF.test(text) || text.split(/\s+/).length > 8) {
            goodbyeAt = null;
            agentSinceCandidate = "";
          }
        } else {
          agentSinceCandidate += text;
          if (GOODBYE.test(agentSinceCandidate)) goodbyeAt ??= Date.now();
        }
      });
    });

    const result = { reason: reason || "sideband closed", hangup: hangupResult || undefined, handoffs };
    await report({
      watcher: "finished",
      ...result,
      events: Object.fromEntries(seen),
      samples: JSON.stringify(samples).length < 12000 ? samples : undefined,
    });
    return { runId, ...result };
  },
});
