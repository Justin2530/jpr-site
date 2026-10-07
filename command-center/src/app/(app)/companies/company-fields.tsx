import { Field } from "@/components/ui";
import type { Tables } from "@/lib/database.types";

export function CompanyFields({ c }: { c?: Tables<"companies"> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Company name" name="name">
        <input id="name" name="name" required defaultValue={c?.name} className="field" />
      </Field>
      <Field label="Name in emails" name="short_name">
        <input id="short_name" name="short_name" defaultValue={c?.short_name ?? ""} placeholder="ALKAB" className="field" />
      </Field>
      <Field label="Status" name="status">
        <select id="status" name="status" defaultValue={c?.status ?? "prospect"} className="field">
          <option value="prospect">Prospect</option>
          <option value="client">Client</option>
          <option value="former_client">Former client</option>
        </select>
      </Field>
      <Field label="Industry" name="industry">
        <input id="industry" name="industry" defaultValue={c?.industry ?? ""} className="field" />
      </Field>
      <Field label="City" name="city">
        <input id="city" name="city" defaultValue={c?.city ?? ""} className="field" />
      </Field>
      <Field label="Phone" name="phone">
        <input id="phone" name="phone" type="tel" defaultValue={c?.phone ?? ""} className="field" />
      </Field>
      <Field label="Website" name="website" className="sm:col-span-2">
        <input id="website" name="website" defaultValue={c?.website ?? ""} className="field" />
      </Field>
      <Field label="Notes" name="notes" className="sm:col-span-2">
        <textarea id="notes" name="notes" rows={3} defaultValue={c?.notes ?? ""} className="field" />
      </Field>
    </div>
  );
}
