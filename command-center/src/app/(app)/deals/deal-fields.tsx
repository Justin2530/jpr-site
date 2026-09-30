import { Field } from "@/components/ui";
import { DEAL_STAGE_LABEL } from "@/lib/format";
import { Constants, type Tables } from "@/lib/database.types";

export function DealFields({
  deal,
  companies,
  contacts,
  companyId,
}: {
  deal?: Tables<"deals">;
  companies: { id: string; name: string }[];
  contacts: { id: string; full_name: string; company_id: string }[];
  companyId?: string;
}) {
  const selected = deal?.company_id ?? companyId;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Deal name" name="title" className="sm:col-span-2">
        <input id="title" name="title" required defaultValue={deal?.title} placeholder="e.g. Acme: 3-search subscription" className="field" />
      </Field>
      <Field label="Company" name="company_id">
        <select id="company_id" name="company_id" required defaultValue={selected ?? ""} className="field">
          <option value="" disabled>
            Pick a company
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contact" name="contact_id">
        <select id="contact_id" name="contact_id" defaultValue={deal?.contact_id ?? ""} className="field">
          <option value="">None</option>
          {contacts
            .filter((p) => !selected || p.company_id === selected)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Stage" name="stage">
        <select id="stage" name="stage" defaultValue={deal?.stage ?? "lead"} className="field">
          {Constants.public.Enums.deal_stage.map((s) => (
            <option key={s} value={s}>
              {DEAL_STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Type" name="deal_type">
        <select id="deal_type" name="deal_type" defaultValue={deal?.deal_type ?? ""} className="field">
          <option value="">Not decided</option>
          <option value="subscription">Subscription</option>
          <option value="contingency">Contingency</option>
        </select>
      </Field>
      <Field label="Value ($, first-year estimate)" name="value">
        <input id="value" name="value" inputMode="decimal" defaultValue={deal?.value ?? ""} className="field" />
      </Field>
      <Field label="Expected close" name="expected_close">
        <input id="expected_close" name="expected_close" type="date" defaultValue={deal?.expected_close ?? ""} className="field" />
      </Field>
      <Field label="Next step" name="next_step">
        <input id="next_step" name="next_step" defaultValue={deal?.next_step ?? ""} placeholder="e.g. Send proposal" className="field" />
      </Field>
      <Field label="Next step due" name="next_step_on">
        <input id="next_step_on" name="next_step_on" type="date" defaultValue={deal?.next_step_on ?? ""} className="field" />
      </Field>
      <Field label="Notes" name="notes" className="sm:col-span-2">
        <textarea id="notes" name="notes" rows={3} defaultValue={deal?.notes ?? ""} className="field" />
      </Field>
    </div>
  );
}
