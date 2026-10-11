import { requireStaff } from "@/lib/staff";
import { PageHeader, Panel } from "@/components/ui";
import { NewJobFlow } from "./new-job-flow";

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
        sub="Drop the client's job description to fill this in, or type it. Then check the questions the AI call should ask."
      />
      <Panel className="max-w-3xl">
        <NewJobFlow companies={companies ?? []} contacts={contacts ?? []} companyId={company} />
      </Panel>
    </>
  );
}
