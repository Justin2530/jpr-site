import { Field } from "@/components/ui";
import { CompanyInput } from "@/components/company-input";
import type { Tables } from "@/lib/database.types";

type Company = { id: string; name: string };
type Contact = { id: string; full_name: string; company_id: string };

export function JobFields({
  job,
  companies,
  contacts,
  companyId,
}: {
  job?: Tables<"jobs">;
  companies: Company[];
  contacts: Contact[];
  companyId?: string;
}) {
  const selected = job?.company_id ?? companyId;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Job title" name="title" className="sm:col-span-2">
        <input id="title" name="title" required defaultValue={job?.title} className="field" />
      </Field>
      <CompanyInput
        companies={companies}
        defaultName={companies.find((c) => c.id === selected)?.name ?? ""}
        contacts={contacts}
        contactField="hiring_contact_id"
        contactLabel="Hiring contact"
        defaultContactId={job?.hiring_contact_id}
      />
      <Field label="Location" name="location">
        <input id="location" name="location" defaultValue={job?.location ?? ""} className="field" />
      </Field>
      <Field label="Pay" name="compensation">
        <input id="compensation" name="compensation" defaultValue={job?.compensation ?? ""} className="field" placeholder="e.g. $22–26/hr" />
      </Field>
      <Field label="Schedule" name="schedule">
        <input id="schedule" name="schedule" defaultValue={job?.schedule ?? ""} className="field" placeholder="e.g. 1st shift, M–F" />
      </Field>
      <Field label="Priority" name="priority">
        <select id="priority" name="priority" defaultValue={String(job?.priority ?? 2)} className="field">
          <option value="1">High</option>
          <option value="2">Normal</option>
          <option value="3">Low</option>
        </select>
      </Field>
      <Field label="Status" name="status">
        <select id="status" name="status" defaultValue={job?.status ?? "open"} className="field">
          <option value="open">Open</option>
          <option value="on_hold">On hold</option>
          <option value="filled">Filled</option>
          <option value="closed">Closed</option>
        </select>
      </Field>
      <Field label="Visibility" name="visibility">
        <select id="visibility" name="visibility" defaultValue={job?.visibility ?? "private"} className="field">
          <option value="private">Private</option>
          <option value="public">Public</option>
          <option value="confidential">Confidential (client name hidden)</option>
        </select>
      </Field>
      <Field label="Job description" name="description" className="sm:col-span-2">
        <textarea id="description" name="description" rows={4} defaultValue={job?.description ?? ""} className="field" />
      </Field>
      <Field label="What candidates can be told" name="candidate_description" className="sm:col-span-2">
        <textarea
          id="candidate_description"
          name="candidate_description"
          rows={3}
          defaultValue={job?.candidate_description ?? ""}
          className="field"
          placeholder="The version of this job the AI caller is allowed to share."
        />
      </Field>
      <Field label="Internal notes (never shared)" name="internal_notes" className="sm:col-span-2">
        <textarea id="internal_notes" name="internal_notes" rows={2} defaultValue={job?.internal_notes ?? ""} className="field" />
      </Field>
    </div>
  );
}
