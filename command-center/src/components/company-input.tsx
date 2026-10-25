"use client";

import { useId, useState } from "react";

type Company = { id: string; name: string };
type Contact = { id: string; full_name: string; company_id: string };

// Type a company name: pick an existing one or a new one gets created on save.
// Optionally shows a contact dropdown limited to the chosen company's people.
export function CompanyInput({
  companies,
  defaultName = "",
  contacts,
  contactField,
  contactLabel = "Contact",
  defaultContactId,
}: {
  companies: Company[];
  defaultName?: string;
  contacts?: Contact[];
  contactField?: string;
  contactLabel?: string;
  defaultContactId?: string | null;
}) {
  const [name, setName] = useState(defaultName);
  const listId = useId();
  const match = companies.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const people = contacts?.filter((p) => p.company_id === match?.id) ?? [];

  return (
    <>
      <div>
        <label className="label" htmlFor={`${listId}-company`}>
          Company
        </label>
        <input
          id={`${listId}-company`}
          name="company_name"
          list={listId}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Start typing a company…"
          autoComplete="off"
          className="field"
        />
        <datalist id={listId}>
          {companies.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        {name.trim() && !match && <p className="mt-1 text-xs text-cyan">New company — it will be added to Companies as a prospect.</p>}
      </div>
      {contactField && (
        <div>
          <label className="label" htmlFor={`${listId}-contact`}>
            {contactLabel}
          </label>
          <select id={`${listId}-contact`} name={contactField} key={match?.id ?? "none"} defaultValue={defaultContactId ?? ""} className="field">
            <option value="">{match ? (people.length ? "None" : "No contacts at this company yet") : "Pick a company first"}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
