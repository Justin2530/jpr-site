import { requireStaff } from "@/lib/staff";
import { Chip, Empty, Field, PageHeader, Panel, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { shortDate, type Tone } from "@/lib/format";
import type { Tables } from "@/lib/database.types";
import { deleteService, saveService } from "./actions";

export const metadata = { title: "Tools & costs · JPR" };

const STATUS_TONE: Record<string, Tone> = { active: "mint", planned: "cyan", cancelled: "muted" };
const BILLING: Record<string, string> = { free: "Free", monthly: "/mo", yearly: "/yr", usage: "Pay per use" };

function price(s: Tables<"services">) {
  if (s.billing === "free") return "Free";
  if (s.billing === "usage") return s.cost !== null ? `~$${s.cost}/mo (usage)` : "Pay per use";
  if (s.cost === null) return "Cost not filled in";
  return `$${Number(s.cost).toLocaleString("en-US")}${BILLING[s.billing]}`;
}

function monthly(s: Tables<"services">) {
  if (s.cost === null || s.billing === "free") return 0;
  return s.billing === "yearly" ? Number(s.cost) / 12 : Number(s.cost);
}

function ServiceForm({ s }: { s?: Tables<"services"> }) {
  return (
    <form action={saveService} className="grid gap-3 sm:grid-cols-2">
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="Name" name={`name-${s?.id ?? "new"}`}>
        <input id={`name-${s?.id ?? "new"}`} name="name" required defaultValue={s?.name} className="field" />
      </Field>
      <Field label="Category" name={`cat-${s?.id ?? "new"}`}>
        <input id={`cat-${s?.id ?? "new"}`} name="category" defaultValue={s?.category ?? ""} placeholder="Core app, AI, Communication, Marketing…" className="field" />
      </Field>
      <Field label="What it's for" name={`purpose-${s?.id ?? "new"}`} className="sm:col-span-2">
        <input id={`purpose-${s?.id ?? "new"}`} name="purpose" defaultValue={s?.purpose ?? ""} className="field" />
      </Field>
      <Field label="Status" name={`status-${s?.id ?? "new"}`}>
        <select id={`status-${s?.id ?? "new"}`} name="status" defaultValue={s?.status ?? "active"} className="field">
          <option value="active">Active</option>
          <option value="planned">Planned</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </Field>
      <Field label="Plan" name={`plan-${s?.id ?? "new"}`}>
        <input id={`plan-${s?.id ?? "new"}`} name="plan" defaultValue={s?.plan ?? ""} className="field" />
      </Field>
      <Field label="Billing" name={`billing-${s?.id ?? "new"}`}>
        <select id={`billing-${s?.id ?? "new"}`} name="billing" defaultValue={s?.billing ?? "monthly"} className="field">
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="usage">Pay per use</option>
          <option value="free">Free</option>
        </select>
      </Field>
      <Field label="Cost ($, typical month for pay-per-use)" name={`cost-${s?.id ?? "new"}`}>
        <input id={`cost-${s?.id ?? "new"}`} name="cost" inputMode="decimal" defaultValue={s?.cost ?? ""} className="field" />
      </Field>
      <Field label="Next renewal" name={`renews-${s?.id ?? "new"}`}>
        <input id={`renews-${s?.id ?? "new"}`} name="renews_on" type="date" defaultValue={s?.renews_on ?? ""} className="field" />
      </Field>
      <Field label="Account email" name={`acct-${s?.id ?? "new"}`}>
        <input id={`acct-${s?.id ?? "new"}`} name="account_email" defaultValue={s?.account_email ?? ""} className="field" />
      </Field>
      <Field label="Billing / login link" name={`url-${s?.id ?? "new"}`} className="sm:col-span-2">
        <input id={`url-${s?.id ?? "new"}`} name="login_url" defaultValue={s?.login_url ?? ""} className="field" />
      </Field>
      <Field label="Limits to watch" name={`watch-${s?.id ?? "new"}`} className="sm:col-span-2">
        <input id={`watch-${s?.id ?? "new"}`} name="watch" defaultValue={s?.watch ?? ""} placeholder="Token allowance, free-tier caps, per-message fees…" className="field" />
      </Field>
      <Field label="Notes" name={`notes-${s?.id ?? "new"}`} className="sm:col-span-2">
        <input id={`notes-${s?.id ?? "new"}`} name="notes" defaultValue={s?.notes ?? ""} className="field" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{s ? "Save" : "Add service"}</SubmitButton>
      </div>
    </form>
  );
}

export default async function ToolsPage() {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") {
    return (
      <>
        <PageHeader title="Tools & costs" />
        <Empty>Only the owner can see tools and costs.</Empty>
      </>
    );
  }
  const { data, error } = await supabase.from("services").select("*").order("sort").order("name");
  if (error) throw new Error(error.message);
  const services = data ?? [];
  const active = services.filter((s) => s.status === "active");
  const planned = services.filter((s) => s.status === "planned");
  const perMonth = active.reduce((sum, s) => sum + monthly(s), 0);
  const plannedPerMonth = planned.reduce((sum, s) => sum + monthly(s), 0);
  const unknown = services.filter((s) => s.status !== "cancelled" && s.billing !== "free" && s.cost === null).length;
  const usage = services.filter((s) => s.status !== "cancelled" && s.billing === "usage").length;

  const groups = new Map<string, typeof services>();
  for (const s of services) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);

  return (
    <>
      <PageHeader
        kicker="Business"
        title="Tools & costs"
        sub="Everything JPR runs on, what it costs, and what to keep an eye on."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly (active)" value={`$${perMonth.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        <Stat label="Yearly (active)" value={`$${(perMonth * 12).toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        <Stat label="Pay-per-use to watch" value={usage} tone="amber" />
        <Stat label="Costs not filled in" value={unknown} tone={unknown ? "rose" : "mint"} />
      </div>
      {plannedPerMonth > 0 && (
        <p className="-mt-3 mb-6 text-sm text-muted">Planned tools add about ${plannedPerMonth.toFixed(0)}/mo once they start.</p>
      )}

      <div className="space-y-6">
        {[...groups].map(([category, rows]) => (
          <Panel key={category} title={category}>
            <ul className="-my-1 divide-y divide-line">
              {rows.map((s) => (
                <li key={s.id} className="py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {s.login_url ? (
                          <a href={s.login_url} target="_blank" rel="noreferrer" className="link font-medium">
                            {s.name}
                          </a>
                        ) : (
                          <span className="font-medium">{s.name}</span>
                        )}
                        <Chip tone={STATUS_TONE[s.status]}>{s.status}</Chip>
                        {s.plan && <Chip>{s.plan}</Chip>}
                      </div>
                      {s.purpose && <p className="mt-0.5 text-sm text-muted">{s.purpose}</p>}
                      {s.watch && <p className="mt-1 text-sm text-amber">Watch: {s.watch}</p>}
                      {s.notes && <p className="mt-0.5 text-sm text-faint">{s.notes}</p>}
                    </div>
                    <div className="text-right">
                      <p className={`readout text-sm ${s.cost === null && s.billing !== "free" && s.billing !== "usage" ? "text-rose" : ""}`}>{price(s)}</p>
                      {s.renews_on && <p className="font-mono text-[11px] text-faint">Renews {shortDate(s.renews_on)}</p>}
                    </div>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-cyan">Edit</summary>
                    <div className="mt-3">
                      <ServiceForm s={s} />
                      <form action={deleteService} className="mt-2">
                        <input type="hidden" name="id" value={s.id} />
                        <button className="text-xs text-faint hover:text-rose">Delete {s.name}</button>
                      </form>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
        <Panel title="Add a tool or subscription">
          <ServiceForm />
        </Panel>
      </div>
    </>
  );
}
