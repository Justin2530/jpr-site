"use client";

import { useState, useTransition } from "react";
import { decideSubmission } from "@/app/(app)/submission-actions";

type Contact = { id: string; full_name: string; title: string | null; email: string | null };

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
}) {
  const [picked, setPicked] = useState<string[]>(preselected);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const chosen = contacts.filter((c) => picked.includes(c.id));
  const emails = chosen.map((c) => c.email).filter(Boolean) as string[];
  const mailto = `mailto:${emails.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  function decide(decision: "save" | "send" | "hold" | "pass") {
    start(async () => {
      setResult(null);
      const res = await decideSubmission({
        candidateJobId,
        submissionId,
        subject,
        body,
        contactIds: picked,
        recipients: chosen.map((c) => c.full_name),
        decision,
      });
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
            ? "Send emails this from your Gmail with the candidate's latest resume attached, logs it, and moves the candidate to Submitted."
            : "Send opens your email app with this filled in and moves the candidate to Submitted. Attach the resume before you hit send."}
        </p>
      )}
    </div>
  );
}
