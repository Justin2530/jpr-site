"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { askJarvis, type JarvisLine } from "./actions";
import type { Pending } from "@/lib/jarvis";

// The browser's own speech recognition (Chrome, Edge, Safari). Not in TypeScript's DOM types yet.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
function recognizer(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return R ? new R() : null;
}

const CHANNEL: Record<string, string> = { text: "text", voice: "call", app: "" };

export function JarvisChat({ initial, initialPending }: { initial: JarvisLine[]; initialPending: Pending | null }) {
  const [lines, setLines] = useState<JarvisLine[]>(initial);
  const [pending, setPending] = useState<Pending | null>(initialPending);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [talking, setTalking] = useState(false); // hands-free: listen, answer out loud, listen again
  const [hearing, setHearing] = useState("");
  const canTalk = useSyncExternalStore(
    () => () => {},
    () => Boolean(recognizer()) && "speechSynthesis" in window,
    () => false,
  );
  const rec = useRef<Recognition | null>(null);
  const talkingRef = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines, busy]);
  useEffect(() => () => stopTalking(), []);

  const speak = (text: string) =>
    new Promise<void>((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
        u.rate = 1.05;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      } catch {
        resolve();
      }
    });

  async function send(text: string) {
    const said = text.trim();
    if (!said || busy) return;
    setDraft("");
    setBusy(true);
    setLines((l) => [...l, { at: new Date().toISOString(), role: "jp", channel: "app", content: said }]);
    const { reply, pending: p } = await askJarvis(said).catch((e) => ({
      reply: `Couldn't reach Jarvis: ${String(e instanceof Error ? e.message : e)}`,
      pending: null,
    }));
    setBusy(false);
    if (reply) setLines((l) => [...l, { at: new Date().toISOString(), role: "jarvis", channel: "app", content: reply }]);
    setPending(p ?? (/^(Done|Cancelled|Heads up|J\. P\., I couldn't)/.test(reply) ? null : pending));
    if (talkingRef.current && reply) {
      await speak(reply);
      if (talkingRef.current) listen();
    }
  }

  function listen() {
    const r = recognizer();
    if (!r) return;
    rec.current = r;
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setHearing(finalText + interim);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") {
        talkingRef.current = false;
        setTalking(false);
        setHearing("Microphone is blocked for this site. Allow it in the browser to talk to Jarvis.");
      }
    };
    r.onend = () => {
      setHearing("");
      if (finalText.trim()) void send(finalText);
      else if (talkingRef.current) setTimeout(() => talkingRef.current && listen(), 250);
    };
    try {
      r.start();
    } catch {
      /* already listening */
    }
  }

  function startTalking() {
    talkingRef.current = true;
    setTalking(true);
    listen();
  }
  function stopTalking() {
    talkingRef.current = false;
    setTalking(false);
    setHearing("");
    try {
      rec.current?.stop();
      window.speechSynthesis?.cancel();
    } catch {
      /* nothing to stop */
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        {lines.length === 0 && !busy ? (
          <p className="text-sm text-muted">
            Try: &ldquo;What needs me today?&rdquo;, &ldquo;Where are we with the ALKAB jobs?&rdquo;, or &ldquo;Text Aaron Jackson that I&rsquo;ll call him at
            3.&rdquo;
          </p>
        ) : (
          <ol className="space-y-3">
            {lines.map((m, i) => {
              const me = m.role === "jp";
              return (
                <li key={i} className={`flex ${me ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl border px-3.5 py-2.5 sm:max-w-[70%] ${
                      me ? "rounded-br-sm border-cyan/30 bg-cyan-soft" : "rounded-bl-sm border-line bg-white/[0.03]"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
                    <p className={`mt-1 font-mono text-[10px] text-faint ${me ? "text-right" : ""}`}>
                      {me ? "J. P." : "Jarvis"}
                      {CHANNEL[m.channel] ? ` · by ${CHANNEL[m.channel]}` : ""} ·{" "}
                      {new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                </li>
              );
            })}
            {busy && (
              <li className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm border border-line bg-white/[0.03] px-3.5 py-2.5 text-sm text-muted">Jarvis is on it…</div>
              </li>
            )}
          </ol>
        )}
        <div ref={end} />
      </div>

      {pending && !busy && (
        <div className="panel flex flex-wrap items-center gap-3 border-amber/40 p-3">
          <p className="min-w-0 flex-1 text-sm">
            <span className="text-amber">Waiting on your confirm:</span> {pending.summary}
          </p>
          <button type="button" className="btn" onClick={() => void send("confirm")}>
            Confirm
          </button>
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-ink" onClick={() => void send("cancel")}>
            Cancel
          </button>
        </div>
      )}

      <form
        className="panel sticky bottom-20 space-y-2 p-3 lg:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            placeholder={talking ? "Listening… just talk" : "Ask Jarvis anything, or tell him what to do…"}
            className="field flex-1 text-sm"
            aria-label="Message to Jarvis"
            disabled={busy}
          />
          {canTalk && (
            <button
              type="button"
              onClick={() => (talking ? stopTalking() : startTalking())}
              className={`shrink-0 rounded-md border px-3 py-2 text-sm ${talking ? "border-rose/50 bg-rose/10 text-rose" : "border-line text-muted hover:text-ink"}`}
            >
              {talking ? "Stop talking" : "Talk"}
            </button>
          )}
          <button type="submit" className="btn shrink-0" disabled={busy || !draft.trim()}>
            Send
          </button>
        </div>
        {hearing && <p className="text-sm text-muted">{hearing}</p>}
      </form>
    </div>
  );
}
