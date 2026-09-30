import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MarketField } from "@/components/market-field";
import { CompanyFields } from "../company-fields";
import { createCompany } from "../actions";

export const metadata = { title: "New client · JPR" };

export default async function NewClient() {
  const { markets } = await requireStaff();
  return (
    <>
      <PageHeader kicker="CRM" title="New client" />
      <Panel className="max-w-2xl">
        <form action={createCompany} className="space-y-4">
          <CompanyFields />
          <MarketField markets={markets} />
          <div className="flex gap-2 pt-2">
            <SubmitButton>Save client</SubmitButton>
            <Link href="/clients" className="btn-quiet">
              Cancel
            </Link>
          </div>
        </form>
      </Panel>
    </>
  );
}
