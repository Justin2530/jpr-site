"use client";

import { useRef, useState, useTransition } from "react";
import { decideSubmission } from "@/app/(app)/submission-actions";

type Contact = { id: string; full_name: string; title: string | null; email: string | null };
type Resume = { id: string; file_name: string };

// Vercel takes about 4.5MB per request; files on file in the Command Center don't count, only ones added here.
const MAX_ADDED = 4 * 1024 * 1024;

// SEND / EDIT / HOLD / PASS on one submission. Nothing goes out by itself: Send emails it from the connected
// Gmail with the resume attached, or opens the email app filled in when Gmail isn't connected.
export function SubmissionEditor({
  candidateJobId,
  submissionId,
  contacts,
  preselected,
  subject: initialSubject,
  body: initialBody,
  locked,
  gmail,
  sentFromGmail,
  resumes = [],
}: {
  candidateJobId: string;
  submissionId?: string;
  contacts: Contact[];
  preselected: string[];
  subject: string;
  body: string;
  locked?: boolean;
  gmail?: boolean;
  sentFromGmail?: boolean;
  resumes?: Resume[];
}) {
  // The latest resume is attached by default; with several on file, a menu picks which one.
  const [resumeId, setResumeId] = useState<string>(resumes[0]?.id ?? "");
  const [added, setAdded] = useState<File[]>([]);
  const [asking, setAsking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const addedSize = added.reduce((n, f) => n + f.size, 0);
  const [picked, setPicked] = useState<string[]>(preselected);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const chosen = contacts.filter((c) => picked.includes(c.id));
  const emails = chosen.map((c) => c.email).filter(Boolean) as string[];
  const mailto = `mailto:${emails.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  function decide(decision: "save" | "send" | "hold" | "pass", sure = false) {
    // Nothing to attach: ask first, so a submission never goes out without a resume by accident.
    if (decision === "send" && gmail && !resumeId && !added.length && !sure) return setAsking(true);
    if (decision === "send" && addedSize > MAX_ADDED)
      return setResult({ ok: false, message: "The added files are over 4MB together. Add a smaller file, or upload the resume to the candidate first." });
    setAsking(false);
    start(async () => {
      setResult(null);
      const files = new FormData();
      added.forEach((f) => files.append("files", f));
      const res = await decideSubmission({
        candidateJobId,
        submissionId,
        subject,
        body,
        contactIds: picked,
        recipients: chosen.map((c) => c.full_name),
        decision,
        resumeIds: resumeId ? [resumeId] : [],
      }, added.length ? files : undefined);
      if (!res.ok) return setResult(res);
      if (decision === "send" && res.viaGmail) setResult(res);
      else if (decision === "send") window.location.href = mailto;
      if (decision === "save") setSaved(true);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="label">Send to</p>
        {contacts.length === 0 ? (
          <p className="text-sm text-muted">No contacts at this company yet. Add one from the company page.</p>
        ) : (
          <ul className="space-y-1.5">
            {contacts.map((c) => (
              <li key={c.id}>
                <label className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-line px-3 py-2 text-sm hover:border-cyan/40">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                    className="accent-cyan"
                  />
                  <span className="font-medium">{c.full_name}</span>
                  <span className="text-muted">{c.title}</span>
                  <span className="ml-auto font-mono text-xs text-faint">{c.email ?? "no email on file"}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label className="label" htmlFor={`subject-${candidateJobId}`}>
          Subject
        </label>
        <input
          id={`subject-${candidateJobId}`}
          value={subject}
          readOnly={locked}
          onChange={(e) => {
            setSubject(e.target.value);
            setSaved(false);
          }}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor={`body-${candidateJobId}`}>
          Message
        </label>
        <textarea
          id={`body-${candidateJobId}`}
          rows={16}
          value={body}
          readOnly={locked}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(false);
          }}
          className="field font-mono text-[13px] leading-relaxed"
        />
      </div>
      {!locked && gmail && (
        <div>
          <p className="label">Attachments</p>
          <div className="space-y-2 rounded-lg border border-line p-3">
            {resumes.length > 1 ? (
              <select value={resumeId} onChange={(e) => setResumeId(e.target.value)} className="field" aria-label="Resume to attach">
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    📎 {r.file_name}
                  </option>
                ))}
                <option value="">No resume</option>
              </select>
            ) : resumes.length === 1 ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={resumeId === resumes[0].id}
                  onChange={(e) => setResumeId(e.target.checked ? resumes[0].id : "")}
                  className="accent-cyan"
                />
                📎 {resumes[0].file_name}
              </label>
            ) : (
              <p className="text-sm text-amber">No resume on file for this candidate. Add one below.</p>
            )}
            {added.map((f, i) => (
              <p key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                📎 {f.name}
                <button type="button" onClick={() => setAdded((a) => a.filter((_, j) => j !== i))} className="text-xs text-muted hover:text-rose">
                  Remove
                </button>
              </p>
            ))}
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setAdded((a) => [...a, ...picked]);
                setAsking(false);
                e.target.value = "";
              }}
            />
            <button type="button" onClick={() => fileInput.current?.click()} className="btn-quiet">
              Add a file
            </button>
          </div>
        </div>
      )}
      {asking && (
        <div className="panel flex flex-wrap items-center gap-2 border-amber/40 px-3 py-2">
          <p className="flex-1 text-sm">Nothing is attached. Add the resume or a file before sending?</p>
          <button type="button" onClick={() => fileInput.current?.click()} className="btn">
            Add a file
          </button>
          <button type="button" onClick={() => decide("send", true)} className="btn-quiet">
            Send without
          </button>
        </div>
      )}
      {locked ? (
        sentFromGmail ? null : (
          <a href={mailto} className="btn-quiet">
            Open in email again
          </a>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => decide("send")} disabled={pending || emails.length === 0} className="btn">
            Send
          </button>
          <button type="button" onClick={() => decide("save")} disabled={pending} className="btn-quiet">
            {saved ? "Saved" : "Save edits"}
          </button>
          <button type="button" onClick={() => decide("hold")} disabled={pending} className="btn-quiet">
            Hold
          </button>
          <button type="button" onClick={() => decide("pass")} disabled={pending} className="btn-quiet hover:text-rose">
            Pass
          </button>
          {pending && <span className="font-mono text-xs text-faint">Working…</span>}
        </div>
      )}
      {result && <p className={`text-sm ${result.ok ? "text-mint" : "text-amber"}`}>{result.message}</p>}
      {!locked && (
        <p className="text-xs text-faint">
          {gmail
            ? "Send emails this from your Gmail with the attachments above, logs it, and moves the candidate to Submitted."
            : "Send opens your email app with this filled in and moves the candidate to Submitted. Attach the resume before you hit send."}
        </p>
      )}
    </div>
  );
}
