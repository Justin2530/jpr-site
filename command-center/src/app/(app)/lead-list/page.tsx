import { requireStaff } from "@/lib/staff";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { DownloadButton } from "./download-button";

export const metadata = { title: "Lead list download · JPR" };

// Justin's download of the master lead list while it's being built (2026-11-12). Not in the menu: the list stays
// out of the Command Center until he approves it. A button fetches the file, because the installed app opens
// plain links in its own window instead of downloading them.
export default async function LeadListPage() {
  const { staff } = await requireStaff();
  if (staff.role !== "owner") return <Empty>Only the owner can download the lead list.</Empty>;
  return (
    <>
      <PageHeader kicker="Master lead list (draft)" title="Download the lead list" sub="Researched so far. Opens in Google Sheets: sheets.new, then File > Import > Upload." />
      <Panel>
        <div className="flex flex-wrap gap-3">
          <DownloadButton href="/api/registry/export" label="Download 4+ businesses" />
          <DownloadButton href="/api/registry/export?all=1" label="Download everything researched" />
        </div>
      </Panel>
    </>
  );
}
