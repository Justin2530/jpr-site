"use client";

import { useEffect, useState } from "react";
import { forgetPushSubscription, savePushSubscription } from "@/app/(app)/messages/actions";

type State = "loading" | "unsupported" | "install" | "off" | "on" | "blocked" | "working";

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Turns phone notifications for new texts and emails on or off for this device. On an iPhone this only
// works from the home-screen app, so it says so in a browser tab.
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    (async () => {
      if (!key || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const standalone = window.matchMedia("(display-mode: standalone)").matches;
        setState(ios && !standalone ? "install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [key]);

  const turnOn = async () => {
    setError(null);
    setState("working");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key!) }));
      await savePushSubscription(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn on notifications.");
      setState("off");
    }
  };

  const turnOff = async () => {
    setState("working");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await forgetPushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
    setState("off");
  };

  if (state === "loading") return null;
  return (
    <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">Notifications on this device</p>
        <p className="text-sm text-muted">
          {state === "on"
            ? "On. New texts and emails from people on file pop up here."
            : state === "install"
              ? "On iPhone, add the Command Center to your home screen first (Share, then Add to Home Screen), open it from there, and turn this on."
              : state === "blocked"
                ? "Blocked for this app. Allow notifications for it in your phone's settings, then come back."
                : state === "unsupported"
                  ? "This browser can't show notifications."
                  : "Get a notification when a candidate or client texts or emails."}
        </p>
        {error && <p className="text-sm text-amber">{error}</p>}
      </div>
      {(state === "off" || state === "on" || state === "working") && (
        <button
          type="button"
          onClick={state === "on" ? turnOff : turnOn}
          disabled={state === "working"}
          className={state === "on" ? "btn-quiet hover:text-rose" : "btn"}
        >
          {state === "working" ? "One moment…" : state === "on" ? "Turn off" : "Turn on notifications"}
        </button>
      )}
    </div>
  );
}
