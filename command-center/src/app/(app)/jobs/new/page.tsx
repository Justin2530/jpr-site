import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { JobFields } from "../job-fields";
import { ScreeningQuestions } from "@/components/screening-questions";
import { createJob } from "../actions";

export const metadata = { title: "New job · JPR" };

export default async function NewJob({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const { supabase } = await requireStaff();
  const [{ data: companies }, { data: contacts }] = await Promise.all([
    supabase.from("companies").select("id, name").neq("status", "former_client").order("name"),
    supabase.from("contacts").select("id, full_name, company_id").order("full_name"),
  ]);

  return (
    <>
      <PageHeader
        kicker="Recruiting"
        title="New job"
        sub="Add the job, then the questions the AI call should ask about it."
      />
      <Panel className="max-w-3xl">
        <form action={createJob} className="space-y-4">
          <JobFields companies={companies ?? []} contacts={contacts ?? []} companyId={company} />
          <ScreeningQuestions />
          <div className="flex gap-2 pt-2">
            <SubmitButton>Save job</SubmitButton>
            <Link href="/jobs" className="btn-quiet">
              Cancel
            </Link>
          </div>
        </form>
      </Panel>
    </>
  );
}
