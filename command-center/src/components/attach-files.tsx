"use client";

import { useRef, useState } from "react";

// Vercel takes about 4.5MB per request, so attachments added from a form stay under 4MB together.
const MAX = 4 * 1024 * 1024;

// "Attach files" for an email form: the picked files ride along as `files` when the form is sent.
export function AttachFiles() {
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const [tooBig, setTooBig] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input
        ref={input}
        type="file"
        name="files"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          const big = files.reduce((n, f) => n + f.size, 0) > MAX;
          setTooBig(big);
          if (big) {
            e.target.value = "";
            setNames([]);
          } else setNames(files.map((f) => f.name));
        }}
      />
      <button type="button" onClick={() => input.current?.click()} className="btn-quiet">
        📎 {names.length ? "Change files" : "Attach files"}
      </button>
      {names.length > 0 && (
        <>
          <span className="text-muted">{names.join(", ")}</span>
          <button
            type="button"
            onClick={() => {
              if (input.current) input.current.value = "";
              setNames([]);
            }}
            className="text-xs text-muted hover:text-rose"
          >
            Remove
          </button>
        </>
      )}
      {tooBig && <span className="text-amber">Those files are over 4MB together. Pick smaller ones.</span>}
    </div>
  );
}
