"use client";

import { useEffect, useRef, useState } from "react";
import { readCapture, saveCapture, type CaptureRead } from "./actions";

type Payload = {
  type: "jpr-capture";
  url: string;
  title: string;
  text: string;
  file: { name: string; type: string; buf: ArrayBuffer } | null;
  links?: string[];
};

const FIELDS = [
  ["full_name", "Name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["city", "City"],
  ["state", "State"],
  ["current_title", "Current title"],
  ["current_employer", "Current employer"],
] as const;

// Receives what the bookmark grabbed from the Indeed page (the page text and, when it could, the resume
// file), reads it, and lets Justin check it before anything is saved.
export function CaptureForm({ jobs }: { jobs: { id: string; label: string }[] }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState<CaptureRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; message: string; id?: string } | null>(null);
  const got = useRef(false);
  const picker = useRef<HTMLInputElement>(null);

  // Reads the page text plus the resume (the grabbed one, or one added by hand).
  const readNow = (p: Payload, f: File | null) => {
    setBusy(true);
    setFailed(false);
    const form = new FormData();
    form.set("page", p.text);
    if (p.links?.length) form.set("links", p.links.join("\n"));
    if (f) form.set("resume", f);
    readCapture(form)
      .then(setRead)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as Payload;
      if (got.current || !d || d.type !== "jpr-capture") return;
      got.current = true;
      const f = d.file?.buf ? new File([d.file.buf], d.file.name || "resume.pdf", { type: d.file.type || "application/pdf" }) : null;
      setPayload(d);
      setFile(f);
      readNow(d, f);
    };
    window.addEventListener("message", onMessage);
    // Tell the Indeed tab this window is ready for the data.
    window.opener?.postMessage("jpr-ready", "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!payload)
    return (
      <p className="text-sm text-muted">
        Waiting for the Indeed page… If nothing happens, close this window and click Send to JPR on the candidate&apos;s Indeed page again.
      </p>
    );

  if (done?.ok)
    return (
      <div className="panel space-y-3 p-4">
        <p className="text-mint">{done.message}</p>
        <div className="flex gap-2">
          <a href={`/candidates/${done.id}`} target="_blank" rel="noreferrer" className="btn">
            Open their profile
          </a>
          <button type="button" onClick={() => window.close()} className="btn-quiet">
            Close
          </button>
        </div>
      </div>
    );

  return (
    <form
      key={read ? "read" : "reading"}
      action={async (form) => {
        if (file) form.set("resume", file);
        form.set("url", payload.url);
        setBusy(true);
        setDone(await saveCapture(form));
        setBusy(false);
      }}
      // Set here, not in the action: state set inside the action only shows once it finishes, so a second press got through.
      onSubmit={() => setBusy(true)}
      className="space-y-3"
    >
      <div className="panel space-y-1 p-3 text-sm">
        <p>
          <span className="text-muted">Resume: </span>
          {file ? `📎 ${file.name}` : <span className="text-amber">Couldn&apos;t grab the file from this page.</span>}
        </p>
        <input
          ref={picker}
          type="file"
          accept=".pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f);
            setRead(null);
            readNow(payload, f);
          }}
        />
        <button type="button" onClick={() => picker.current?.click()} className="text-xs text-cyan hover:underline">
          {file ? "Use a different file" : "Add the resume by hand"}
        </button>
        {busy && !read && <p className="text-faint">Reading…</p>}
        {failed && <p className="text-xs text-amber">Couldn&apos;t read the details. Fill them in below, or add the resume and it reads again.</p>}
        {read && <p className="text-xs text-faint">Details read from the {read.readFrom === "resume" ? "resume" : "Indeed page"}. Check them below.</p>}
      </div>

      {read?.match && (
        <div className="panel border-amber/40 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="match_id" value={read.match.id} defaultChecked className="accent-cyan" />
            Already in the system as <strong>{read.match.full_name}</strong>. Update them with these details and this resume.
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map(([name, label]) => (
          <label key={name} className={name === "full_name" || name === "email" ? "col-span-2" : ""}>
            <span className="label">{label}</span>
            <input name={name} defaultValue={read?.fields[name] ?? ""} className="field" required={name === "full_name"} />
          </label>
        ))}
      </div>

      <label className="block">
        <span className="label">Job</span>
        <select name="job_id" defaultValue={read?.jobId ?? ""} className="field">
          <option value="">No job yet</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
        {read?.jobWhy && <span className="block text-xs text-cyan">{read.jobWhy}</span>}
        <span className="text-xs text-faint">They go on the job as Sourced. Nothing automatic starts.</span>
      </label>

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !read} className="btn">
          {busy && read ? "Saving…" : "Add to JPR"}
        </button>
        <button type="button" onClick={() => window.close()} className="btn-quiet">
          Cancel
        </button>
      </div>
      {done && !done.ok && <p className="text-sm text-amber">{done.message}</p>}
    </form>
  );
}
