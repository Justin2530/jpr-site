import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { Chip, Field, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { label, money } from "@/lib/format";
import { updatePlacement } from "../actions";

export default async function PlacementDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff();
  const { data: p } = await supabase
    .from("placements")
    .select("*, candidate_jobs(candidates(id, full_name), jobs(id, title, companies(id, name)))")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();
  const cj = p.candidate_jobs;

  return (
    <>
      <PageHeader
        kicker={
          <Link href="/placements" className="hover:text-cyan">
            Placements
          </Link>
        }
        title={cj?.candidates?.full_name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/jobs/${cj?.jobs?.id}`} className="link">
              {cj?.jobs?.title}
            </Link>
            <span>at</span>
            <Link href={`/companies/${cj?.jobs?.companies?.id}`} className="link">
              {cj?.jobs?.companies?.name}
            </Link>
            <Chip tone="mint">{p.covered_by_subscription ? "Subscription" : money(p.fee_amount)}</Chip>
            <Chip>{label(p.invoice_status)}</Chip>
          </span>
        }
      />
      <Panel title="Placement details" className="max-w-3xl">
        <form action={updatePlacement} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={p.id} />
          <Field label="Start date" name="start_date">
            <input id="start_date" name="start_date" type="date" defaultValue={p.start_date ?? ""} className="field" />
          </Field>
          <Field label="First-year pay ($)" name="compensation">
            <input id="compensation" name="compensation" inputMode="decimal" defaultValue={p.compensation ?? ""} className="field" />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="covered_by_subscription" defaultChecked={p.covered_by_subscription} className="accent-cyan" />
            Covered by the client&apos;s subscription (no placement fee)
          </label>
          <Field label="Fee (%)" name="fee_percent">
            <input id="fee_percent" name="fee_percent" inputMode="decimal" defaultValue={p.fee_percent ?? ""} className="field" />
          </Field>
          <Field label="Fee ($, leave blank to calculate)" name="fee_amount">
            <input id="fee_amount" name="fee_amount" inputMode="decimal" defaultValue={p.fee_amount ?? ""} className="field" />
          </Field>
          <Field label="Invoice" name="invoice_status">
            <select id="invoice_status" name="invoice_status" defaultValue={p.invoice_status} className="field">
              <option value="not_invoiced">Not invoiced</option>
              <option value="invoiced">Invoiced</option>
              <option value="paid">Paid</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </Field>
          <Field label="Guarantee ends" name="guarantee_until">
            <input id="guarantee_until" name="guarantee_until" type="date" defaultValue={p.guarantee_until ?? ""} className="field" />
          </Field>
          <Field label="Invoiced on" name="invoiced_on">
            <input id="invoiced_on" name="invoiced_on" type="date" defaultValue={p.invoiced_on ?? ""} className="field" />
          </Field>
          <Field label="Paid on" name="paid_on">
            <input id="paid_on" name="paid_on" type="date" defaultValue={p.paid_on ?? ""} className="field" />
          </Field>
          <Field label="Notes" name="notes" className="sm:col-span-2">
            <textarea id="notes" name="notes" rows={3} defaultValue={p.notes ?? ""} className="field" />
          </Field>
          <div>
            <SubmitButton>Save placement</SubmitButton>
          </div>
        </form>
      </Panel>
    </>
  );
}
