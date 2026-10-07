import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Stat } from "@/components/ui";
import { FilterTabs } from "@/components/view-switcher";
import { label, money, shortDate, type Tone } from "@/lib/format";

export const metadata = { title: "Placements · JPR" };

const INVOICE_TONE: Record<string, Tone> = { not_invoiced: "amber", invoiced: "cyan", paid: "mint", not_applicable: "muted" };

export default async function PlacementsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period = "year" } = await searchParams;
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("placements")
    .select("*, candidate_jobs(id, stage_changed_at, candidates(id, full_name), jobs(id, title, companies(id, name)))")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const now = new Date();
  const from =
    period === "month"
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : period === "quarter"
        ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
        : period === "year"
          ? new Date(now.getFullYear(), 0, 1)
          : null;
  const rows = (data ?? []).filter((p) => !from || new Date(p.start_date ?? p.created_at) >= from);
  const fees = rows.reduce((s, p) => s + Number(p.fee_amount ?? 0), 0);
  const outstanding = rows.filter((p) => p.invoice_status === "invoiced").reduce((s, p) => s + Number(p.fee_amount ?? 0), 0);
  const toInvoice = rows.filter((p) => p.invoice_status === "not_invoiced").length;

  return (
    <>
      <PageHeader
        kicker="Recruiting"
        title="Placements"
        sub="Moving a candidate to Placed creates a placement here. Fill in the start date, pay and fee."
      />
      <div className="mb-4">
        <FilterTabs
          tabs={[
            ["month", "This month"],
            ["quarter", "This quarter"],
            ["year", "This year"],
            ["all", "All time"],
          ]}
          current={period}
          basePath="/placements"
          paramName="period"
        />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Placements" value={rows.length} tone="mint" />
        <Stat label="Fees" value={money(fees)} />
        <Stat label="Invoiced, not paid" value={money(outstanding)} tone={outstanding ? "amber" : "cyan"} />
        <Stat label="Need an invoice" value={toInvoice} tone={toInvoice ? "rose" : "cyan"} />
      </div>
      {rows.length === 0 ? (
        <Empty>No placements in this period yet.</Empty>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Candidate", "Job", "Company", "Start", "Pay", "Fee", "Invoice", "Guarantee ends"].map((h) => (
                  <th key={h} className="panel-title px-4 py-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => {
                const cj = p.candidate_jobs;
                return (
                  <tr key={p.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <Link href={`/placements/${p.id}`} className="link font-medium">
                        {cj?.candidates?.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/jobs/${cj?.jobs?.id}`} className="link text-muted">
                        {cj?.jobs?.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{cj?.jobs?.companies?.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{p.start_date ? shortDate(p.start_date) : <span className="text-amber">Add date</span>}</td>
                    <td className="readout px-4 py-2.5">{money(p.compensation)}</td>
                    <td className="readout px-4 py-2.5 text-cyan">{p.covered_by_subscription ? "Subscription" : money(p.fee_amount)}</td>
                    <td className="px-4 py-2.5">
                      <Chip tone={INVOICE_TONE[p.invoice_status]}>{label(p.invoice_status)}</Chip>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-faint">{shortDate(p.guarantee_until)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
