import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DealFields } from "../deal-fields";
import { createDeal } from "../actions";

export const metadata = { title: "New deal · JPR" };

export default async function NewDeal({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const { supabase } = await requireStaff();
  const [{ data: companies }, { data: contacts }] = await Promise.all([
    supabase.from("companies").select("id, name").order("name"),
    supabase.from("contacts").select("id, full_name, company_id").order("full_name"),
  ]);
  return (
    <>
      <PageHeader kicker="Sales" title="New deal" />
      {(companies ?? []).length === 0 ? (
        <Empty>
          Add the company first.{" "}
          <Link href="/companies/new" className="link text-cyan">
            New company
          </Link>
        </Empty>
      ) : (
        <Panel className="max-w-3xl">
          <form action={createDeal} className="space-y-4">
            <DealFields companies={companies!} contacts={contacts ?? []} companyId={company} />
            <div className="flex gap-2 pt-2">
              <SubmitButton>Save deal</SubmitButton>
              <Link href="/deals" className="btn-quiet">
                Cancel
              </Link>
            </div>
          </form>
        </Panel>
      )}
    </>
  );
}
