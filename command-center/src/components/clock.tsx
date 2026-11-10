"use client";

import { useEffect, useState } from "react";

// Live local time readout for the top bar.
export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (!now) return <span className="readout text-sm text-muted">--:--</span>;
  return (
    <span className="readout text-sm text-muted">
      {now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
      <span className="mx-2 text-faint">·</span>
      <span className="text-cyan">{now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
    </span>
  );
}
