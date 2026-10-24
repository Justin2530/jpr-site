"use client";

import { LEAD_STATUS_LABEL } from "@/lib/leads-shared";
import { setLeadStatus } from "./actions";

// Changes a lead's status the moment a new one is picked.
export function LeadStatus({ business, line, status }: { business: string; line: string; status: string }) {
  return (
    <form action={setLeadStatus}>
      <input type="hidden" name="business" value={business} />
      <input type="hidden" name="line" value={line} />
      <select
        name="status"
        defaultValue={status}
        aria-label="Lead status"
        className="field w-auto py-1 text-xs"
        onChange={(e) => {
          if (e.target.value === "do_not_contact" && !window.confirm("Do not contact on every JPR list (Local, USA and AI)?")) {
            e.target.value = status;
            return;
          }
          e.target.form?.requestSubmit();
        }}
      >
        {Object.entries(LEAD_STATUS_LABEL).map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </form>
  );
}
