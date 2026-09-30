"use client";

import { useState, useTransition } from "react";
import { connectTwilioNumber } from "./actions";

export function ConnectButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn"
        disabled={disabled || pending}
        onClick={() => start(async () => setResult(await connectTwilioNumber()))}
      >
        {pending ? "Connecting…" : "Connect my business number"}
      </button>
      {result && <p className={`text-sm ${result.ok ? "text-mint" : "text-amber"}`}>{result.message}</p>}
    </div>
  );
}
