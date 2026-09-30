"use client";

import { useState } from "react";
import { ChatIcon, MailIcon, PhoneIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { logCorrespondence } from "@/app/(app)/outreach-actions";

type Kind = "call" | "text" | "email";
const WORD: Record<Kind, string> = { call: "call", text: "text", email: "email" };

// Call / Text / Email open the phone or mail app. Afterwards a small form logs it, with what was said,
// into the correspondence history. Once Twilio and Gmail are connected these log themselves.
export function ReachOut({
  phone,
  email,
  links,
  path,
}: {
  phone: string | null;
  email: string | null;
  links: { candidate_id?: string; contact_id?: string; company_id?: string; deal_id?: string };
  path: string;
}) {
  const [logging, setLogging] = useState<Kind | null>(null);
  const digits = phone?.replace(/[^\d+]/g, "");

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
        {button("call", digits ? `tel:${digits}` : null, <PhoneIcon className="h-4 w-4" />, "Call")}
        {button("text", digits ? `sms:${digits}` : null, <ChatIcon className="h-4 w-4" />, "Text")}
        {button("email", email ? `mailto:${email}` : null, <MailIcon className="h-4 w-4" />, "Email")}
        {!logging && (
          <button type="button" onClick={() => setLogging("call")} className="btn-quiet text-muted">
            Log
          </button>
        )}
      </div>
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
