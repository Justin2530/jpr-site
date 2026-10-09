"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// The phone app opens on Messages. Only on launch of the home-screen app on a phone-sized screen; tapping
// Home afterwards still shows What needs me, and the computer always starts there.
export function PhoneStart() {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    try {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!standalone || window.innerWidth >= 1024 || sessionStorage.getItem("jpr-launched")) return;
      sessionStorage.setItem("jpr-launched", "1");
      if (path === "/") router.replace("/messages");
    } catch {
      // Storage blocked: stay on home.
    }
    // Only the first page of a launch decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
