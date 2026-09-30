import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ContactFields } from "../contact-fields";
import { createContactRecord } from "../actions";

export const metadata = { title: "New contact · JPR" };

export default async function NewContact({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const { supabase } = await requireStaff();
  const { data: companies } = await supabase.from("companies").select("id, name").order("name");
  return (
    <>
      <PageHeader kicker="Sales" title="New contact" />
      {(companies ?? []).length === 0 ? (
        <Empty>
          Add their company first.{" "}
          <Link href="/companies/new" className="link text-cyan">
            New company
          </Link>
        </Empty>
      ) : (
        <Panel className="max-w-2xl">
          <form action={createContactRecord} className="space-y-4">
            <ContactFields companies={companies!} companyId={company} />
            <div className="flex gap-2 pt-2">
              <SubmitButton>Save contact</SubmitButton>
              <Link href="/contacts" className="btn-quiet">
                Cancel
              </Link>
            </div>
          </form>
        </Panel>
      )}
    </>
  );
}
