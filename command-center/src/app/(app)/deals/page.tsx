import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Stat } from "@/components/ui";
import { Board } from "@/components/board";
import { ViewSwitcher } from "@/components/view-switcher";
import { PlusIcon } from "@/components/icons";
import { daysSince, DEAL_STAGE_LABEL, DEAL_STAGE_TONE, money, shortDate } from "@/lib/format";
import { Constants } from "@/lib/database.types";
import { moveDeal } from "./actions";

export const metadata = { title: "Deals · JPR" };

const STALE_DAYS = 10;

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "board" } = await searchParams;
  const { supabase } = await requireStaff();
  const { data: deals, error } = await supabase
    .from("deals")
    .select("*, companies(id, name), contacts(full_name)")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  const all = deals ?? [];
  const recentCutoff = 90;
  const visible = all.filter((d) => !["won", "lost"].includes(d.stage) || daysSince(d.closed_at) <= recentCutoff);
  const open = all.filter((d) => !["won", "lost"].includes(d.stage));
  const openValue = open.reduce((s, d) => s + Number(d.value ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const due = open.filter((d) => d.next_step_on && d.next_step_on <= today).length;
  const quarterStart = new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1).toISOString();
  const wonQ = all.filter((d) => d.stage === "won" && d.closed_at && d.closed_at >= quarterStart);

  const footer = Object.fromEntries(
    Constants.public.Enums.deal_stage.map((s) => {
      const v = visible.filter((d) => d.stage === s).reduce((sum, d) => sum + Number(d.value ?? 0), 0);
      return [s, v ? money(v) : ""];
    }),
  );

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Deals"
        sub={`Companies you're trying to win. A red dot means no movement in ${STALE_DAYS}+ days or a next step is overdue.`}
        action={
          <div className="flex gap-2">
            <ViewSwitcher
              basePath="/deals"
              current={view}
              options={[
                { key: "board", label: "Board" },
                { key: "list", label: "List" },
              ]}
            />
            <Link href="/deals/new" className="btn">
              <PlusIcon className="h-4 w-4" /> New deal
            </Link>
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open deals" value={open.length} />
        <Stat label="Open value" value={money(openValue)} />
        <Stat label="Follow-ups due" value={due} tone={due ? "amber" : "cyan"} />
        <Stat label="Won this quarter" value={`${wonQ.length} · ${money(wonQ.reduce((s, d) => s + Number(d.value ?? 0), 0))}`} tone="mint" />
      </div>

      {visible.length === 0 ? (
        <Empty>No deals yet. Add one for each company you&apos;re pitching.</Empty>
      ) : view === "list" ? (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Deal", "Company", "Stage", "Value", "Next step", "Due", "Expected close"].map((h) => (
                  <th key={h} className="panel-title px-4 py-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((d) => (
                <tr key={d.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/deals/${d.id}`} className="link font-medium">
                      {d.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/companies/${d.companies?.id}`} className="link text-muted">
                      {d.companies?.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip tone={DEAL_STAGE_TONE[d.stage]}>{DEAL_STAGE_LABEL[d.stage]}</Chip>
                  </td>
                  <td className="readout px-4 py-2.5">{money(d.value)}</td>
                  <td className="max-w-56 truncate px-4 py-2.5 text-muted">{d.next_step}</td>
                  <td className={`px-4 py-2.5 font-mono text-xs ${d.next_step_on && d.next_step_on <= today ? "text-rose" : "text-faint"}`}>
                    {shortDate(d.next_step_on)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-faint">{shortDate(d.expected_close)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Board
          columns={Constants.public.Enums.deal_stage.map((s) => ({ key: s, label: DEAL_STAGE_LABEL[s], tone: DEAL_STAGE_TONE[s] }))}
          cards={visible.map((d) => ({
            id: d.id,
            column: d.stage,
            title: d.title,
            href: `/deals/${d.id}`,
            sub: [d.companies?.name, d.contacts?.full_name].filter(Boolean).join(" · "),
            meta: d.next_step ? `Next: ${d.next_step}` : "No next step",
            badge: d.value ? money(d.value) : undefined,
            flag:
              !["won", "lost"].includes(d.stage) &&
              (daysSince(d.stage_changed_at) >= STALE_DAYS || Boolean(d.next_step_on && d.next_step_on <= today) || !d.next_step),
          }))}
          move={moveDeal}
          footer={footer}
        />
      )}
    </>
  );
}
