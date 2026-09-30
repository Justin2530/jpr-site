import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Field, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MarketField } from "@/components/market-field";
import { CandidateFields } from "../candidate-fields";
import { createCandidate } from "../actions";

export const metadata = { title: "New candidate · JPR" };

export default async function NewCandidate({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const { supabase, markets } = await requireStaff();
  const { data: jobs } = await supabase.from("jobs").select("id, title, companies(name)").eq("status", "open").order("title");

  return (
    <>
      <PageHeader kicker="ATS" title="New candidate" />
      <Panel className="max-w-3xl">
        <form action={createCandidate} className="space-y-4">
          <CandidateFields />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Resume (PDF or Word, up to 10MB)" name="resume">
              <input
                id="resume"
                name="resume"
                type="file"
                accept=".pdf,.doc,.docx,.rtf,.txt"
                className="field file:mr-3 file:rounded file:border-0 file:bg-cyan-soft file:px-2 file:py-1 file:text-cyan"
              />
            </Field>
            <Field label="Assign to job (optional)" name="job_id">
              <select id="job_id" name="job_id" defaultValue={job ?? ""} className="field">
                <option value="">Don&apos;t assign yet</option>
                {(jobs ?? []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} · {j.companies?.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <MarketField markets={markets} />
          <div className="flex gap-2 pt-2">
            <SubmitButton>Save candidate</SubmitButton>
            <Link href="/candidates" className="btn-quiet">
              Cancel
            </Link>
          </div>
        </form>
      </Panel>
    </>
  );
}
