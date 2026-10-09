"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BackIcon, ForwardIcon, RefreshIcon } from "@/components/icons";

// Installed as an app there's no browser bar, so the header carries back, forward and refresh.
export function BrowserButtons() {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const btn = "flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-cyan-soft hover:text-cyan";
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" className={btn} onClick={() => router.back()} aria-label="Back" title="Back">
        <BackIcon />
      </button>
      <button type="button" className={btn} onClick={() => router.forward()} aria-label="Forward" title="Forward">
        <ForwardIcon />
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => start(() => router.refresh())}
        aria-label="Refresh"
        title="Refresh"
      >
        <RefreshIcon className={`h-[18px] w-[18px] ${refreshing ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
