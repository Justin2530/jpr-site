"use client";

import { useEffect, useRef } from "react";

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789JPR";
const SIZE = 16;

// Faint falling code behind the Matrix look. Runs only while the Matrix theme and falling code are both on,
// pauses when the tab is hidden, and stays still for people who ask their device for less motion.
export function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const root = document.documentElement;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let drops: number[] = [];
    let timer: ReturnType<typeof setInterval> | null = null;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drops = Array.from({ length: Math.ceil(canvas.width / SIZE) }, () => Math.random() * -60);
    };
    const frame = () => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00ff66";
      ctx.font = `${SIZE}px monospace`;
      drops.forEach((y, i) => {
        ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], i * SIZE, y * SIZE);
        drops[i] = y * SIZE > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
      });
    };
    const sync = () => {
      const on = root.dataset.theme === "matrix" && root.dataset.rain !== "off" && !still.matches;
      canvas.style.display = on ? "block" : "none";
      const run = on && !document.hidden;
      if (run && !timer) {
        resize();
        timer = setInterval(frame, 70);
      } else if (!run && timer) {
        clearInterval(timer);
        timer = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    const watch = new MutationObserver(sync);
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-rain"] });
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("resize", resize);
    still.addEventListener("change", sync);
    sync();
    return () => {
      watch.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("resize", resize);
      still.removeEventListener("change", sync);
      if (timer) clearInterval(timer);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 hidden opacity-[0.16]" />;
}
