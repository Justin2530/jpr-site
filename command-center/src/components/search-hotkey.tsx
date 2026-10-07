"use client";

import { useEffect } from "react";

// Press "/" anywhere (outside a text field) to jump to the search box.
export function SearchHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || t.closest("input, textarea, select, [contenteditable]")) return;
      const box = document.querySelector<HTMLInputElement>('input[name="q"][aria-label="Search"]');
      if (box) {
        e.preventDefault();
        box.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
