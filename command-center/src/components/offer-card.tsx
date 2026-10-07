"use client";

import { useState, useTransition } from "react";
import { askClientToConfirm, cancelRelayMessage, dropOffer, saveOffer, sendOffer, sendRelayMessage } from "@/app/(app)/relay-actions";

type Result = { ok: boolean; message: string } | null;

// The offer card: the terms the system read from the client's email, editable, and nothing goes to the
// candidate until Send offer. "Ask to confirm" emails the client first; their yes brings this back.
export function OfferCard({
  offerId,
  status,
  clear,
  terms: initialTerms,
  startDate: initialStart,
  contactFirst,
  hasLetter,
}: {
  offerId: string;
  status: string;
  clear: boolean;
  terms: string;
  startDate: string | null;
  contactFirst: string;
  hasLetter: boolean;
}) {
  const [terms, setTerms] = useState(initialTerms);
  const [start, setStart] = useState(initialStart ?? "");
  const [pending, run] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const act = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    run(async () => {
      setResult(null);
      setResult(await fn());
    });
  const open = ["review", "ready", "confirm_asked"].includes(status);
  const note =
    status === "confirm_asked"
      ? `Waiting on ${contactFirst} to confirm. Their yes brings this back for your click.`
      : status === "ready"
        ? `${contactFirst} confirmed. Click Send offer when you're ready.`
        : clear
          ? "A clear, formal offer. Check the terms and click Send offer."
          : `This one needs checking. Ask ${contactFirst} to confirm, or fix the terms and send.`;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{note}</p>
      <label className="block">
        <span className="label">Terms the candidate will see, word for word</span>
        <textarea className="field min-h-28 font-mono text-sm" value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!open || pending} />
      </label>
      <label className="block w-48">
        <span className="label">Start date</span>
        <input type="date" className="field" value={start} onChange={(e) => setStart(e.target.value)} disabled={!open || pending} />
      </label>
      {hasLetter && <p className="text-xs text-faint">Any PDF the client attached goes along with the email.</p>}
      {open && (
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={pending} onClick={() => act(() => sendOffer({ offerId, terms, startDate: start }))}>
            Send offer
          </button>
          {status !== "confirm_asked" && (
            <button className="btn-quiet" disabled={pending} onClick={() => act(() => askClientToConfirm(offerId))}>
              Ask {contactFirst} to confirm
            </button>
          )}
          <button className="btn-quiet" disabled={pending} onClick={() => act(() => saveOffer({ offerId, terms, startDate: start }))}>
            Save
          </button>
          <button className="btn-quiet hover:text-rose" disabled={pending} onClick={() => act(() => dropOffer(offerId))}>
            Drop
          </button>
        </div>
      )}
      {result && <p className={`text-sm ${result.ok ? "text-mint" : "text-rose"}`}>{result.message}</p>}
    </div>
  );
}

// A counteroffer message waiting on Justin: edit it if needed, then send or keep it.
export function RelayMessageCard({ id, toLabel, body: initialBody }: { id: string; toLabel: string; body: string }) {
  const [body, setBody] = useState(initialBody);
  const [pending, run] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const act = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    run(async () => {
      setResult(null);
      setResult(await fn());
    });
  return (
    <div className="space-y-2 rounded-lg border border-amber/40 p-3">
      <p className="text-sm font-medium">Waiting on you: message to {toLabel}</p>
      <textarea className="field min-h-24 text-sm" value={body} onChange={(e) => setBody(e.target.value)} disabled={pending || result?.ok} />
      {!result?.ok && (
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={pending} onClick={() => act(() => sendRelayMessage({ id, body }))}>
            Send
          </button>
          <button className="btn-quiet" disabled={pending} onClick={() => act(() => cancelRelayMessage(id))}>
            Don&apos;t send
          </button>
        </div>
      )}
      {result && <p className={`text-sm ${result.ok ? "text-mint" : "text-rose"}`}>{result.message}</p>}
    </div>
  );
}
