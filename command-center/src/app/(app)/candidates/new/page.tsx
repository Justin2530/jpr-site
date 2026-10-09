import { requireStaff } from "@/lib/staff";
import { PageHeader, Panel } from "@/components/ui";
import { MarketField } from "@/components/market-field";
import { NewCandidateFlow } from "./new-candidate-flow";
import { automationState } from "@/lib/automation-state";

export const metadata = { title: "New candidate · JPR" };

export default async function NewCandidate({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const { supabase, markets } = await requireStaff();
  const automation = await automationState(supabase);
  const { data: jobs } = await supabase.from("jobs").select("id, title, automation_pilot, companies(name)").eq("status", "open").order("title");

  return (
    <>
      <PageHeader kicker="Recruiting" title="New candidate" />
      <Panel className="max-w-3xl">
        <NewCandidateFlow
          jobs={(jobs ?? []).map((j) => ({ id: j.id, title: j.title, company: j.companies?.name ?? "", auto: j.automation_pilot }))}
          presetJob={job}
          automationOn={automation.on}
          marketField={<MarketField markets={markets} />}
        />
      </Panel>
    </>
  );
}
