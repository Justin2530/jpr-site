import { Field } from "@/components/ui";
import { SOURCE_LABEL } from "@/lib/format";
import { Constants, type Tables } from "@/lib/database.types";

export function CandidateFields({ c }: { c?: Tables<"candidates"> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" name="full_name" className="sm:col-span-2">
        <input id="full_name" name="full_name" required defaultValue={c?.full_name} className="field" />
      </Field>
      <Field label="Phone" name="phone">
        <input id="phone" name="phone" type="tel" defaultValue={c?.phone ?? ""} className="field" />
      </Field>
      <Field label="Email" name="email">
        <input id="email" name="email" type="email" defaultValue={c?.email ?? ""} className="field" />
      </Field>
      <Field label="Current title" name="current_title">
        <input id="current_title" name="current_title" defaultValue={c?.current_title ?? ""} className="field" />
      </Field>
      <Field label="Current employer" name="current_employer">
        <input id="current_employer" name="current_employer" defaultValue={c?.current_employer ?? ""} className="field" />
      </Field>
      <Field label="City" name="city">
        <input id="city" name="city" defaultValue={c?.city ?? ""} className="field" />
      </Field>
      <Field label="State" name="state">
        <input id="state" name="state" defaultValue={c?.state ?? "PA"} className="field" />
      </Field>
      <Field label="Source" name="source">
        <select id="source" name="source" defaultValue={c?.source ?? "indeed"} className="field">
          {Constants.public.Enums.candidate_source.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="LinkedIn" name="linkedin_url">
        <input id="linkedin_url" name="linkedin_url" defaultValue={c?.linkedin_url ?? ""} className="field" />
      </Field>
      <Field label="Notes" name="notes" className="sm:col-span-2">
        <textarea id="notes" name="notes" rows={3} defaultValue={c?.notes ?? ""} className="field" />
      </Field>
      <div className="rounded-lg border border-line p-3 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="contact_consent" defaultChecked={c?.contact_consent ?? false} className="accent-cyan" />
          Agreed to be contacted by phone and text
        </label>
        <input
          name="contact_consent_note"
          defaultValue={c?.contact_consent_note ?? ""}
          placeholder="How they agreed (e.g. applied on Indeed, said yes on a call)"
          className="field mt-2"
          aria-label="How consent was given"
        />
      </div>
    </div>
  );
}
