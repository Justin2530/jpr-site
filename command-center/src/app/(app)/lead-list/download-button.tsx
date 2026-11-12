"use client";

import { useState } from "react";

export function DownloadButton({ href, label }: { href: string; label: string }) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  async function go() {
    setState("working");
    try {
      const res = await fetch(href, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "JPR Local leads.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setState("idle");
    } catch {
      setState("error");
    }
  }
  return (
    <button onClick={go} disabled={state === "working"} className="btn">
      {state === "working" ? "Building file…" : state === "error" ? "Didn't work, tap to retry" : label}
    </button>
  );
}
