"use client";

import { useEffect, useRef, useState } from "react";
import { sendEmail, sendText, type OutreachResult } from "@/app/(app)/outreach-actions";
import { SubmitButton } from "@/components/submit-button";
import { AttachFiles } from "@/components/attach-files";

// The reply bar under a conversation: a text from JPR's number, or an email from Gmail in the same thread.
export function ReplyBox({
  links,
  path,
  name,
  phone,
  email,
  thread,
  subject,
  through,
  start,
  textBlocked,
}: {
  links: Record<string, string>;
  path: string;
  name: string;
  phone: string | null;
  email: string | null;
  thread: string | null;
  subject: string | null;
  through: string | null;
  start: "text" | "email";
  textBlocked: string | null;
}) {
  const [mode, setMode] = useState<"text" | "email">(start === "text" && phone ? "text" : email ? "email" : "text");
  const [result, setResult] = useState<OutreachResult | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    window.scrollTo({ top: document.body.scrollHeight });
  }, []);

  const can = mode === "text" ? Boolean(phone) && !textBlocked : Boolean(email);
  const why = mode === "text" ? (textBlocked ?? (phone ? null : "No phone number on file.")) : email ? null : "No email on file.";

  return (
    <form
      ref={form}
      action={async (data) => {
        const r = mode === "text" ? await sendText(data) : await sendEmail(data);
        setResult(r);
        if (r.ok) form.current?.reset();
      }}
      className="panel sticky bottom-20 space-y-2 p-3 lg:bottom-4"
    >
      {Object.entries(links).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="to" value={phone ?? ""} />
      <input type="hidden" name="email" value={email ?? ""} />
      {mode === "email" && thread && <input type="hidden" name="thread_id" value={thread} />}
      <div className="flex items-center gap-1.5">
        {(["text", "email"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setResult(null);
            }}
            className={`rounded-md border px-2.5 py-1 text-xs ${mode === m ? "border-cyan/50 bg-cyan-soft text-cyan" : "border-line text-muted hover:text-ink"}`}
          >
            {m === "text" ? "Text" : "Email"}
          </button>
        ))}
        <span className="ml-auto truncate text-xs text-faint">
          {mode === "text" ? "From JPR's business number" : through ? `Through ${through}` : `From your Gmail to ${email ?? "them"}`}
        </span>
      </div>
      {mode === "email" && (
        <input
          key={`subject-${mode}`}
          name="subject"
          required
          defaultValue={subject ? (/^re:/i.test(subject) ? subject : `Re: ${subject}`) : ""}
          placeholder="Subject"
          className="field"
          aria-label="Subject"
        />
      )}
      <div className="flex items-end gap-2">
        <textarea
          name="body"
          rows={mode === "email" ? 5 : 2}
          required
          disabled={!can}
          placeholder={why ?? (mode === "text" ? `Text ${name.split(" ")[0]}…` : `Email ${name.split(" ")[0]}…`)}
          className="field flex-1 text-sm"
          aria-label="Message"
        />
        <SubmitButton className="btn shrink-0" pendingText="Sending…" disabled={!can}>
          Send
        </SubmitButton>
      </div>
      {mode === "email" && <AttachFiles key={result?.message ?? "files"} />}
      {result && <p className={`text-sm ${result.ok ? "text-mint" : "text-amber"}`}>{result.message}</p>}
    </form>
  );
}
