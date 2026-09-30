"use client";

import { useState, useTransition } from "react";
import { ChatIcon, MailIcon, PhoneIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { addCallNotes, logCorrespondence, sendText, startCall, type OutreachResult } from "@/app/(app)/outreach-actions";

type Kind = "call" | "text" | "email";
const WORD: Record<Kind, string> = { call: "call", text: "text", email: "email" };

// With Twilio connected, Call rings your cell and connects you, and Text sends from JPR's number; both log
// themselves. Without it they open the phone app and a small form logs what was said. Email opens the mail app.
export function ReachOut({
  phone,
  email,
  name,
  links,
  path,
  twilio = false,
  optedOut = false,
}: {
  phone: string | null;
  email: string | null;
  name?: string;
  links: { candidate_id?: string; contact_id?: string; company_id?: string; deal_id?: string };
  path: string;
  twilio?: boolean;
  optedOut?: boolean;
}) {
  const [logging, setLogging] = useState<Kind | null>(null);
  const [composing, setComposing] = useState(false);
  const [result, setResult] = useState<OutreachResult | null>(null);
  const [callSid, setCallSid] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const digits = phone?.replace(/[^\d+]/g, "");
  const hidden = (
    <>
      {Object.entries(links).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="to" value={phone ?? ""} />
      <input type="hidden" name="name" value={name ?? ""} />
    </>
  );
  const call = () =>
    start(async () => {
      const form = new FormData();
      Object.entries({ ...links, path, to: phone ?? "", name: name ?? "" }).forEach(([k, v]) => v && form.set(k, v));
      const r = await startCall(form);
      setResult(r);
      if (r.sid) setCallSid(r.sid);
    });

  const button = (kind: Kind, href: string | null, icon: React.ReactNode, label: string) =>
    href ? (
      <a href={href} onClick={() => setLogging(kind)} className="btn-quiet">
        {icon} {label}
      </a>
    ) : (
      <span className="btn-quiet cursor-not-allowed opacity-40" title={`No ${kind === "email" ? "email" : "phone"} on file`}>
        {icon} {label}
      </span>
    );

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {twilio && digits ? (
          <>
            <button type="button" onClick={call} disabled={pending} className="btn-quiet">
              <PhoneIcon className="h-4 w-4" /> {pending ? "Calling…" : "Call"}
            </button>
            <button
              type="button"
              onClick={() => setComposing((c) => !c)}
              disabled={optedOut}
              title={optedOut ? "Replied STOP, so texting is blocked" : undefined}
              className={`btn-quiet ${optedOut ? "opacity-40" : ""}`}
            >
              <ChatIcon className="h-4 w-4" /> {optedOut ? "Opted out" : "Text"}
            </button>
          </>
        ) : (
          <>
            {button("call", digits ? `tel:${digits}` : null, <PhoneIcon className="h-4 w-4" />, "Call")}
            {button("text", digits ? `sms:${digits}` : null, <ChatIcon className="h-4 w-4" />, "Text")}
          </>
        )}
        {button("email", email ? `mailto:${email}` : null, <MailIcon className="h-4 w-4" />, "Email")}
        {!logging && (
          <button type="button" onClick={() => setLogging("call")} className="btn-quiet text-muted">
            Log
          </button>
        )}
      </div>
      {result && <p className={`max-w-md text-right text-sm ${result.ok ? "text-mint" : "text-amber"}`}>{result.message}</p>}
      {composing && (
        <form
          action={async (form) => {
            const r = await sendText(form);
            setResult(r);
            if (r.ok) setComposing(false);
          }}
          className="panel w-full max-w-md space-y-2 p-3 text-left"
        >
          {hidden}
          <textarea name="body" rows={4} required placeholder={`Text ${name ?? "them"}…`} className="field text-sm" aria-label="Message" />
          <div className="flex items-center gap-2">
            <SubmitButton className="btn" pendingText="Sending…">
              Send text
            </SubmitButton>
            <button type="button" onClick={() => setComposing(false)} className="btn-quiet">
              Cancel
            </button>
            <span className="ml-auto text-xs text-faint">From JPR&apos;s business number</span>
          </div>
        </form>
      )}
      {callSid && (
        <form
          action={async (form) => {
            await addCallNotes(form);
            setCallSid(null);
            setResult(null);
          }}
          className="panel w-full max-w-md space-y-2 p-3 text-left"
        >
          <input type="hidden" name="sid" value={callSid} />
          <input type="hidden" name="path" value={path} />
          <input name="summary" placeholder="What was the call about?" className="field" aria-label="Summary" />
          <textarea name="body" rows={4} placeholder="Notes from the conversation" className="field text-sm" aria-label="Notes" />
          <div className="flex gap-2">
            <SubmitButton className="btn">Save notes</SubmitButton>
            <button type="button" onClick={() => setCallSid(null)} className="btn-quiet">
              Later
            </button>
          </div>
        </form>
      )}
      {logging && (
        <form
          action={async (form) => {
            await logCorrespondence(form);
            setLogging(null);
          }}
          className="panel w-full max-w-md space-y-2 p-3 text-left"
        >
          {Object.entries(links).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="path" value={path} />
          <div className="flex gap-2">
            <select
              name="kind"
              value={logging}
              onChange={(e) => setLogging(e.target.value as Kind)}
              className="field w-auto"
              aria-label="Type"
            >
              <option value="call">Call</option>
              <option value="text">Text</option>
              <option value="email">Email</option>
            </select>
            <select name="direction" defaultValue="out" className="field w-auto" aria-label="Direction">
              <option value="out">I reached out</option>
              <option value="in">They reached out</option>
            </select>
            {logging === "call" && (
              <input name="minutes" inputMode="decimal" placeholder="Min" className="field w-16" aria-label="Minutes" />
            )}
          </div>
          <input name="summary" placeholder={`What was the ${WORD[logging]} about?`} className="field" aria-label="Summary" />
          <textarea
            name="body"
            rows={4}
            placeholder={logging === "call" ? "Notes from the conversation" : `Paste the ${WORD[logging]} here`}
            className="field text-sm"
            aria-label="Details"
          />
          <div className="flex gap-2">
            <SubmitButton className="btn">Save to history</SubmitButton>
            <button type="button" onClick={() => setLogging(null)} className="btn-quiet">
              Skip
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
