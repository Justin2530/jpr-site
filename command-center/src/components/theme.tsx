"use client";

import { useState } from "react";

export type Theme = "jarvis" | "matrix";

// The look lives on <html data-theme data-rain>; cookies keep it so the server renders it the same way next time.
function save(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`rounded-md px-3 py-1 text-sm transition ${value === v ? "bg-cyan-soft text-cyan" : "text-muted hover:text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function AppearanceSettings({ theme: initialTheme, rain: initialRain }: { theme: Theme; rain: boolean }) {
  const [theme, setTheme] = useState(initialTheme);
  const [rain, setRain] = useState(initialRain);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink">Look</p>
          <p className="text-sm text-muted">JARVIS is navy and cyan. Matrix is black and green.</p>
        </div>
        <Choice
          value={theme}
          options={[
            ["jarvis", "JARVIS"],
            ["matrix", "Matrix"],
          ]}
          onChange={(v) => {
            setTheme(v);
            save("jpr-theme", v);
            document.documentElement.dataset.theme = v;
          }}
        />
      </div>
      {theme === "matrix" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink">Falling code</p>
            <p className="text-sm text-muted">Faint green code running behind everything.</p>
          </div>
          <Choice
            value={rain ? "on" : "off"}
            options={[
              ["on", "On"],
              ["off", "Off"],
            ]}
            onChange={(v) => {
              setRain(v === "on");
              save("jpr-rain", v);
              document.documentElement.dataset.rain = v;
            }}
          />
        </div>
      )}
    </div>
  );
}
