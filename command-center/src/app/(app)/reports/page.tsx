import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { FilterTabs } from "@/components/view-switcher";
import { daysSince, DEAL_STAGE_LABEL, money, SOURCE_LABEL, STAGE_LABEL } from "@/lib/format";
import { Constants, type Enums } from "@/lib/database.types";

export const metadata = { title: "Reports · JPR" };

// Rough odds of closing at each stage, for a weighted sales pipeline.
const DEAL_WEIGHT: Record<string, number> = { lead: 0.1, contacted: 0.2, meeting: 0.4, proposal: 0.6 };
const FUNNEL: Enums<"pipeline_stage">[] = ["submitted", "interviewing", "offer", "placed"];

function periodStart(period: string) {
  const now = new Date();
  if (period === "week") return new Date(now.getTime() - 7 * 86_400_000);
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "quarter") return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  if (period === "year") return new Date(now.getFullYear(), 0, 1);
  return new Date(2000, 0, 1);
}

function Bars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2 rounded-full bg-white/[0.04]">
            <span className="block h-2 rounded-full bg-cyan/70 shadow-[0_0_10px_rgb(var(--glow)/0.5)]" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="readout w-20 text-right text-xs">{r.sub ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period = "month" } = await searchParams;
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") {
    return (
      <>
        <PageHeader title="Reports" />
        <Empty>Only the owner can see reports.</Empty>
      </>
    );
  }
  const from = periodStart(period).toISOString();

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [stages, activity, placements, deals, agreements, jobs, placedMonth] = await Promise.all([
    supabase.from("candidate_jobs").select("stage, candidates(source)"),
    supabase.from("activities").select("kind, summary, occurred_at, candidate_id, candidates(source)").gte("occurred_at", from).limit(5000),
    supabase.from("placements").select("fee_amount, invoice_status, start_date, created_at, candidate_jobs(jobs(companies(name)))"),
    supabase.from("deals").select("stage, value, closed_at, created_at"),
    supabase.from("agreements").select("type, status, monthly_price, end_date"),
    supabase.from("jobs").select("id, title, opened_on, companies(name), candidate_jobs(stage)").eq("status", "open"),
    supabase.from("candidate_jobs").select("id", { count: "exact", head: true }).eq("stage", "placed").gte("stage_changed_at", monthStart),
  ]);
  // Right now (moved here from the home page, Justin 2026-10-09).
  const closed = ["placed", "passed", "withdrawn", "couldnt_contact"];
  const current = {
    openJobs: (jobs.data ?? []).length,
    inPipeline: (stages.data ?? []).filter((r) => !closed.includes(r.stage)).length,
    ready: (stages.data ?? []).filter((r) => r.stage === "ready_to_submit").length,
    placedMonth: placedMonth.count ?? 0,
    openDeals: (deals.data ?? []).filter((d) => d.stage !== "won" && d.stage !== "lost").length,
  };

  // Pipeline right now
  const now = Constants.public.Enums.pipeline_stage
    .filter((s) => !["passed", "withdrawn", "couldnt_contact"].includes(s))
    .map((s) => ({ label: STAGE_LABEL[s], value: (stages.data ?? []).filter((r) => r.stage === s).length }));

  // Funnel in period: count moves into each stage (from the activity log).
  const acts = activity.data ?? [];
  const moved = (s: string) => acts.filter((a) => a.kind === "stage" && a.summary.endsWith(`→ ${s.replace(/_/g, " ")}`));
  const assigned = acts.filter((a) => a.kind === "assigned").length;
  const funnel = [{ label: "Assigned", value: assigned }, ...FUNNEL.map((s) => ({ label: STAGE_LABEL[s], value: moved(s).length }))];
  const rate = (a: number, b: number) => (a ? `${Math.round((b / a) * 100)}%` : "—");

  // Activity counts
  const kinds = ["call", "text", "email", "meeting", "note"].map((k) => ({ label: k[0].toUpperCase() + k.slice(1) + "s", value: acts.filter((a) => a.kind === k).length }));

  // Sources: submittals and placements by candidate source
  const bySource = Constants.public.Enums.candidate_source
    .map((src) => {
      const sub = moved("submitted").filter((a) => a.candidates?.source === src).length;
      const placed = moved("placed").filter((a) => a.candidates?.source === src).length;
      return { label: SOURCE_LABEL[src], value: sub + placed, sub: `${sub} sub · ${placed} placed` };
    })
    .filter((r) => r.value > 0);

  // Money
  const pl = (placements.data ?? []).filter((p) => (p.start_date ?? p.created_at) >= from.slice(0, 10));
  const fees = pl.reduce((s, p) => s + Number(p.fee_amount ?? 0), 0);
  const paid = pl.filter((p) => p.invoice_status === "paid").reduce((s, p) => s + Number(p.fee_amount ?? 0), 0);
  const outstanding = (placements.data ?? []).filter((p) => p.invoice_status === "invoiced").reduce((s, p) => s + Number(p.fee_amount ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const mrr = (agreements.data ?? [])
    .filter((a) => a.type === "subscription" && a.status === "active" && (!a.end_date || a.end_date >= today))
    .reduce((s, a) => s + Number(a.monthly_price ?? 0), 0);
  const byClient = Object.entries(
    pl.reduce<Record<string, number>>((acc, p) => {
      const n = p.candidate_jobs?.jobs?.companies?.name ?? "Unknown";
      acc[n] = (acc[n] ?? 0) + Number(p.fee_amount ?? 0);
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n, v]) => ({ label: n, value: v, sub: money(v) }));

  // Sales
  const d = deals.data ?? [];
  const openDeals = d.filter((x) => !["won", "lost"].includes(x.stage));
  const weighted = openDeals.reduce((s, x) => s + Number(x.value ?? 0) * (DEAL_WEIGHT[x.stage] ?? 0), 0);
  const won = d.filter((x) => x.stage === "won" && x.closed_at && x.closed_at >= from);
  const lost = d.filter((x) => x.stage === "lost" && x.closed_at && x.closed_at >= from);
  const dealStages = (["lead", "contacted", "meeting", "proposal"] as const).map((s) => {
    const inStage = openDeals.filter((x) => x.stage === s);
    const v = inStage.reduce((sum, x) => sum + Number(x.value ?? 0), 0);
    return { label: DEAL_STAGE_LABEL[s], value: v || inStage.length, sub: `${inStage.length} · ${money(v)}` };
  });

  const tabs = [
    ["week", "7 days"],
    ["month", "This month"],
    ["quarter", "This quarter"],
    ["year", "This year"],
    ["all", "All time"],
  ] as const;

  return (
    <>
      <PageHeader
        kicker="Business"
        title="Reports"
        sub="Where everything stands, at a glance."
        action={
          <details className="relative">
            <summary className="btn-quiet cursor-pointer list-none">Export CSV</summary>
            <div className="panel absolute right-0 z-30 mt-1 min-w-44 bg-panel-solid p-1">
              {["candidates", "jobs", "pipeline", "placements", "companies", "contacts", "deals"].map((t) => (
                <a key={t} href={`/export/${t}`} className="block rounded-md px-3 py-1.5 text-sm capitalize text-muted hover:bg-white/[0.04] hover:text-ink">
                  {t}
                </a>
              ))}
            </div>
          </details>
        }
      />
      <p className="panel-title mb-2">Right now</p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Open jobs" value={current.openJobs} href="/jobs" />
        <Stat label="In pipeline" value={current.inPipeline} href="/pipeline" />
        <Stat label="Ready to submit" value={current.ready} tone="amber" href="/pipeline" />
        <Stat label="Placed this month" value={current.placedMonth} tone="mint" href="/placements?period=month" />
        <Stat label="Open deals" value={current.openDeals} href="/deals" />
      </div>

      <div className="mb-5">
        <FilterTabs tabs={tabs} current={period} basePath="/reports" paramName="period" />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Placement fees" value={money(fees)} tone="mint" />
        <Stat label="Collected" value={money(paid)} />
        <Stat label="Invoiced, unpaid (all)" value={money(outstanding)} tone={outstanding ? "amber" : "cyan"} />
        <Stat label="Subscription revenue / mo" value={money(mrr)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Recruiting funnel (this period)">
          <Bars rows={funnel} />
          <p className="mt-4 font-mono text-[11px] text-faint">
            Submitted → interview {rate(funnel[1].value, funnel[2].value)} · interview → offer {rate(funnel[2].value, funnel[3].value)} · offer → placed{" "}
            {rate(funnel[3].value, funnel[4].value)}
          </p>
        </Panel>
        <Panel title="Pipeline right now">
          <Bars rows={now} />
        </Panel>
        <Panel title="Sales pipeline">
          <Bars rows={dealStages} />
          <p className="mt-4 font-mono text-[11px] text-faint">
            Weighted value {money(weighted)} · won {won.length} ({money(won.reduce((s, x) => s + Number(x.value ?? 0), 0))}) · lost {lost.length} · win rate{" "}
            {rate(won.length + lost.length, won.length)}
          </p>
        </Panel>
        <Panel title="Activity logged (this period)">
          <Bars rows={kinds} />
        </Panel>
        <Panel title="Fees by client (this period)">{byClient.length ? <Bars rows={byClient} /> : <Empty>No placement fees yet.</Empty>}</Panel>
        <Panel title="Best candidate sources (this period)">{bySource.length ? <Bars rows={bySource} /> : <Empty>No submittals yet.</Empty>}</Panel>
        <Panel title="Open jobs" className="lg:col-span-2">
          {(jobs.data ?? []).length === 0 ? (
            <Empty>No open jobs.</Empty>
          ) : (
            <div className="-m-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Job", "Company", "Days open", "Active", "Submitted", "Interviewing"].map((h) => (
                      <th key={h} className="panel-title px-4 py-2.5 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {jobs.data!
                    .map((j) => ({ ...j, days: daysSince(j.opened_on) }))
                    .sort((a, b) => b.days - a.days)
                    .map((j) => (
                      <tr key={j.id}>
                        <td className="px-4 py-2">
                          <Link href={`/jobs/${j.id}`} className="link">
                            {j.title}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-muted">{j.companies?.name}</td>
                        <td className={`readout px-4 py-2 ${j.days > 30 ? "text-amber" : ""}`}>{j.days}</td>
                        <td className="readout px-4 py-2">{j.candidate_jobs.filter((c) => !["placed", "passed", "withdrawn", "on_hold", "couldnt_contact"].includes(c.stage)).length}</td>
                        <td className="readout px-4 py-2">{j.candidate_jobs.filter((c) => c.stage === "submitted").length}</td>
                        <td className="readout px-4 py-2">{j.candidate_jobs.filter((c) => c.stage === "interviewing").length}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
