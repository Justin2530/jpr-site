"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkEmail } from "@/app/(app)/email-sync-actions";

// Keeps email replies flowing in while the Command Center is open: on load, every two minutes,
// and whenever the window comes back into focus. Refreshes the page when something new arrived.
export function EmailSync() {
  const router = useRouter();
  useEffect(() => {
    let busy = false;
    const run = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        if ((await checkEmail()) > 0) router.refresh();
      } catch {
        // offline or signed out; try again next time
      } finally {
        busy = false;
      }
    };
    run();
    const timer = setInterval(run, 120_000);
    window.addEventListener("focus", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [router]);
  return null;
}
