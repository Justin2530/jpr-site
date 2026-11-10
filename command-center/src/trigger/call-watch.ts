import { logger, task } from "@trigger.dev/sdk";
import { watchCall } from "../lib/call-watch";

// The same call watcher as /api/screening/watch, runnable on Trigger.dev for a whole call at once.
// Not used for calls right now: OpenAI didn't find the live session when attaching from Trigger.dev.
export type CallWatchPayload = { sessionId: string; runId: string };

export const callWatch = task({
  id: "screening-call-watch",
  maxDuration: 1200,
  run: async ({ sessionId, runId }: CallWatchPayload) =>
    watchCall({
      sessionId,
      runId,
      callStartedAt: Date.now(),
      budgetMs: 17 * 60_000,
      slice: 1,
      log: (m, d) => logger.info(m, d),
    }),
});
