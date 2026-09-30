import { Field } from "@/components/ui";
import type { Tables } from "@/lib/database.types";

export function ContactFields({
  c,
  companies,
  companyId,
}: {
  c?: Tables<"contacts">;
  companies: { id: string; name: string }[];
  companyId?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" name="full_name">
        <input id="full_name" name="full_name" required defaultValue={c?.full_name} className="field" />
      </Field>
      <Field label="Title" name="title">
        <input id="title" name="title" defaultValue={c?.title ?? ""} className="field" />
      </Field>
      <Field label="Company" name="company_id" className="sm:col-span-2">
        <select id="company_id" name="company_id" required defaultValue={c?.company_id ?? companyId ?? ""} className="field">
          <option value="" disabled>
            Pick a company
          </option>
          {companies.map((co) => (
            <option key={co.id} value={co.id}>
              {co.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Phone" name="phone">
        <input id="phone" name="phone" type="tel" defaultValue={c?.phone ?? ""} className="field" />
      </Field>
      <Field label="Email" name="email">
        <input id="email" name="email" type="email" defaultValue={c?.email ?? ""} className="field" />
      </Field>
      <Field label="Notes" name="notes" className="sm:col-span-2">
        <textarea id="notes" name="notes" rows={3} defaultValue={c?.notes ?? ""} className="field" />
      </Field>
    </div>
  );
}
