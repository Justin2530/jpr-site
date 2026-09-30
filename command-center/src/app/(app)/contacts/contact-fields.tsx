import { Field } from "@/components/ui";
import { CompanyInput } from "@/components/company-input";
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
      <div className="sm:col-span-2">
        <CompanyInput companies={companies} defaultName={companies.find((co) => co.id === (c?.company_id ?? companyId))?.name ?? ""} />
      </div>
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
