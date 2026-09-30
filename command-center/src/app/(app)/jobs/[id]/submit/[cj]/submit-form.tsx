"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markSubmitted } from "@/app/(app)/pipeline-actions";

type Contact = { id: string; full_name: string; title: string | null; email: string | null };

// Pick who gets it, adjust the wording, then open it in the mail app and mark it submitted.
export function SubmitForm({
  cjId,
  jobId,
  contacts,
  preselected,
  subject: initialSubject,
  body: initialBody,
}: {
  cjId: string;
  jobId: string;
  contacts: Contact[];
  preselected: string[];
  subject: string;
  body: string;
}) {
  const [picked, setPicked] = useState<string[]>(preselected);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [pending, start] = useTransition();
  const router = useRouter();
  const chosen = contacts.filter((c) => picked.includes(c.id));
  const emails = chosen.map((c) => c.email).filter(Boolean) as string[];

  function go(openMail: boolean) {
    start(async () => {
      await markSubmitted(
        cjId,
        chosen.map((c) => c.full_name),
      );
      if (openMail) {
        window.location.href = `mailto:${emails.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
      router.push(`/jobs/${jobId}`);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Send to</p>
        {contacts.length === 0 ? (
          <p className="text-sm text-muted">No contacts at this company yet. Add one from the company page, or just mark it submitted.</p>
        ) : (
          <ul className="space-y-1.5">
            {contacts.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:border-cyan/40">
                  <input
                    type="checkbox"
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
        <label className="label" htmlFor="subject">
          Subject
        </label>
        <input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="body">
          Message
        </label>
        <textarea id="body" rows={14} value={body} onChange={(e) => setBody(e.target.value)} className="field font-mono text-sm" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => go(true)} disabled={pending || emails.length === 0} className="btn">
          {pending ? "Saving…" : "Open in email & mark submitted"}
        </button>
        <button type="button" onClick={() => go(false)} disabled={pending} className="btn-quiet">
          Just mark submitted
        </button>
      </div>
      <p className="text-xs text-faint">Nothing is sent automatically. Your email app opens with this filled in, and you hit send.</p>
    </div>
  );
}
