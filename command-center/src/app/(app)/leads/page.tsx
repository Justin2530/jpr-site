import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { shortDate, timeAgo, type Tone } from "@/lib/format";
import { LINE_LABEL, SERPER_FREE_CREDITS, sizeBand, type LeadLine } from "@/lib/leads-shared";
import type { Enums } from "@/lib/database.types";
import { addToCompanies, setSearchStatus } from "./actions";
import { LeadStatus } from "./lead-status";
import { NewSearch } from "./new-search";

export const metadata = { title: "Lead Engine · JPR" };

const PER_PAGE = 50;
const SEARCH_TONE: Record<Enums<"lead_search_status">, Tone> = { queued: "cyan", running: "cyan", paused: "amber", done: "mint", canceled: "muted" };
const VERIFY: Record<string, { text: string; tone: Tone }> = {
  deliverable: { text: "✓ deliverable", tone: "mint" },
  risky: { text: "risky", tone: "amber" },
  undeliverable: { text: "× undeliverable", tone: "rose" },
  unknown: { text: "unknown", tone: "muted" },
};
const LINE_NOTE: Record<LeadLine, string> = {
  local: "Employers in and around Jefferson County for JPR's recruiting emails.",
  usa: "Machine shops and manufacturers nationwide for JPR USA.",
  ai: "Businesses for JPR AI's audit emails. The list stays here as a download; nothing is sent to the AI system.",
};

type Search = { line?: string; status?: string; verified?: string; size?: string; state?: string; trade?: string; exported?: string; q?: string; page?: string };
type Overview = {
  businesses: number;
  emails: number;
  deliverable: number;
  mx_ok: number;
  exported: number;
  customers: number;
  likely: number;
  spend_all: number;
  spend_today: number;
  per_state: { state: string; total: number; verified: number }[];
  per_tier: { high: number; medium: number; low: number };
  fb_queue: Record<string, number>;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") {
    return (
      <>
        <PageHeader title="Lead Engine" />
        <Empty>Only the owner can use the Lead Engine.</Empty>
      </>
    );
  }
  const line: LeadLine = sp.line === "usa" || sp.line === "ai" ? sp.line : "local";
  const page = Math.max(1, Number(sp.page) || 1);
  const hasKey = !!process.env.SERPER_API_KEY?.trim();
  const hasBouncer = !!process.env.BOUNCER_API_KEY?.trim();
  const hasBrightData = !!process.env.BRIGHTDATA_API_KEY?.trim();

  let list = supabase
    .from("lead_list_members")
    .select(
      "status, exported_at, campaign, created_at, lead_businesses!inner(id, name, category, address, city, county, state, phone, website, domain, facebook_url, primary_email, email_source, emails, email_status, email_verification, owner_name, owner_title, size_score, rating, review_count, enrich_status, enriched_at, fb_status, excluded_reason, company_id, created_at)",
      { count: "exact" },
    )
    .eq("line", line)
    .order("created_at", { ascending: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  if (sp.status && sp.status !== "all") list = list.eq("status", sp.status as Enums<"lead_status">);
  if (sp.verified === "1") list = hasBouncer ? list.eq("lead_businesses.email_verification", "deliverable") : list.eq("lead_businesses.email_status", "mx_ok");
  if (sp.size === "high") list = list.gte("lead_businesses.size_score", 50);
  if (sp.size === "medium") list = list.gte("lead_businesses.size_score", 30).lt("lead_businesses.size_score", 50);
  if (sp.size === "low") list = list.lt("lead_businesses.size_score", 30);
  if (sp.state) list = list.eq("lead_businesses.state", sp.state);
  if (sp.trade) list = list.eq("lead_businesses.category", sp.trade);
  if (sp.exported === "yes") list = list.not("exported_at", "is", null);
  if (sp.exported === "no") list = list.is("exported_at", null);
  if (sp.q) {
    const q = sp.q.replace(/[%_,()*]/g, " ").trim();
    list = list.or(`name.ilike.%${q}%,website.ilike.%${q}%,phone.ilike.%${q}%,primary_email.ilike.%${q}%`, { referencedTable: "lead_businesses" });
  }

  const [listRes, overviewRes, searchesRes, creditsRes, tradesRes] = await Promise.all([
    list,
    supabase.rpc("lead_overview", { p_line: line }),
    supabase.from("lead_searches").select("*").eq("line", line).order("created_at", { ascending: false }).limit(20),
    supabase.from("lead_searches").select("credits_used"),
    supabase.from("lead_list_members").select("lead_businesses!inner(category)").eq("line", line).not("lead_businesses.category", "is", null).limit(5000),
  ]);
  if (listRes.error) throw new Error(listRes.error.message);
  const leads = listRes.data ?? [];
  const total = listRes.count ?? 0;
  const ov = (overviewRes.data ?? null) as Overview | null;
  const searches = searchesRes.data ?? [];
  const creditsUsed = (creditsRes.data ?? []).reduce((s, r) => s + r.credits_used, 0);
  const trades = [...new Set((tradesRes.data ?? []).map((r) => r.lead_businesses.category).filter((c): c is string => !!c))].sort();
  const reading = searches.some((s) => s.status === "running" || s.status === "queued");
  const verifiedCount = hasBouncer ? (ov?.deliverable ?? 0) : (ov?.mx_ok ?? 0);
  const fbQueue = Object.entries(ov?.fb_queue ?? {});

  const qs = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, line, ...over })) if (v) p.set(k, String(v));
    return `/leads?${p}`;
  };

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Lead Engine"
        sub="Finds businesses on Google Maps by county and keyword, then gets their emails from their websites and Facebook pages and checks them. Nothing is ever sent from here."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(LINE_LABEL) as LeadLine[]).map((l) => (
          <Link
            key={l}
            href={`/leads?line=${l}`}
            className={`chip px-3 py-1 ${l === line ? "border-cyan/50 text-cyan" : "border-line text-muted hover:text-ink"}`}
          >
            {LINE_LABEL[l]}
          </Link>
        ))}
      </div>
      <p className="-mt-1 mb-4 text-sm text-muted">{LINE_NOTE[line]}</p>

      {(!hasKey || !hasBouncer || !hasBrightData) && (
        <p className="mb-4 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
          Waiting on keys in Vercel:{" "}
          {[!hasKey && "Serper (searches)", !hasBouncer && "Bouncer (email checks)", !hasBrightData && "Bright Data (Facebook emails)"].filter(Boolean).join(", ")}. Everything else runs.
        </p>
      )}

      {/* Overview, as in WellThree */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total businesses" value={(ov?.businesses ?? 0).toLocaleString()} />
        <Stat label={hasBouncer ? "Verified emails" : "Working emails"} value={verifiedCount.toLocaleString()} tone="mint" />
        <Stat label="Exported" value={(ov?.exported ?? 0).toLocaleString()} />
        <Stat label="Total spend" value={money(Number(ov?.spend_all ?? 0))} tone="amber" />
        <Stat label="Cost / verified lead" value={verifiedCount ? money(Number(ov?.spend_all ?? 0) / verifiedCount) : "—"} tone="amber" />
      </div>
      <p className="mb-6 text-xs text-faint">
        {(ov?.emails ?? 0).toLocaleString()} emails found · {(ov?.customers ?? 0).toLocaleString()} customers · today {money(Number(ov?.spend_today ?? 0))} · Serper credits{" "}
        {creditsUsed.toLocaleString()} of {SERPER_FREE_CREDITS.toLocaleString()} free used
        {fbQueue.length > 0 && ` · Facebook queue: ${fbQueue.map(([k, n]) => `${n} ${k}`).join(", ")}`}
      </p>

      <div className="space-y-6">
        {ov && ov.businesses > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="By state">
              <ul className="-my-1 divide-y divide-line text-sm">
                {ov.per_state.map((r) => (
                  <li key={r.state} className="flex justify-between py-1.5">
                    <Link href={qs({ state: r.state, page: undefined })} className="link">
                      {r.state}
                    </Link>
                    <span className="readout text-muted">
                      {r.total.toLocaleString()} <span className="text-mint">({r.verified.toLocaleString()} verified)</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="By tier (size guess)">
              <ul className="-my-1 divide-y divide-line text-sm">
                {(
                  [
                    ["high", "High · likely 5+"],
                    ["medium", "Medium · maybe 5+"],
                    ["low", "Low · likely small"],
                  ] as const
                ).map(([k, t]) => (
                  <li key={k} className="flex justify-between py-1.5">
                    <Link href={qs({ size: k, page: undefined })} className="link">
                      {t}
                    </Link>
                    <span className="readout text-muted">{ov.per_tier[k].toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )}

        <details className="panel" open={searches.length === 0}>
          <summary className="cursor-pointer px-4 py-3 panel-title">Big search</summary>
          <div className="border-t border-line p-4">
            <NewSearch line={line} hasKey={hasKey} creditsUsed={creditsUsed} freeCredits={SERPER_FREE_CREDITS} />
          </div>
        </details>

        <Panel title="Background jobs and run history" action={reading ? <span className="text-xs text-muted">Runs every 2 minutes</span> : undefined}>
          {searches.length === 0 ? (
            <Empty>No {LINE_LABEL[line]} searches yet. Start one under Big search.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-line">
              {searches.map((s) => {
                const pct = s.task_count ? Math.min(100, Math.round(((s.credits_used + s.failed_count) / Math.max(s.task_count, 1)) * 100)) : 0;
                const active = s.status === "running" || s.status === "queued";
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        <Chip tone={SEARCH_TONE[s.status]}>{s.status}</Chip>
                      </div>
                      {active && (
                        <div className="mt-1.5 h-1.5 max-w-md overflow-hidden rounded bg-white/5">
                          <div className="h-full bg-cyan transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      <p className="mt-1 text-sm text-muted">
                        {s.new_count.toLocaleString()} businesses found
                        {s.target_count ? ` (stops at ${s.target_count.toLocaleString()})` : ""} · {s.credits_used.toLocaleString()} of up to{" "}
                        {s.max_credits.toLocaleString()} credits · spend {money(Number(s.spend_usd))}
                        {s.new_count ? ` · ${money(Number(s.spend_usd) / s.new_count)}/business` : ""}
                        {active ? ` · about ${pct}% through` : ""}
                        {s.failed_count ? ` · ${s.failed_count} searches failed` : ""} · started {timeAgo(s.created_at)}
                      </p>
                      {s.error && (s.status === "paused" || s.failed_count > 0) && <p className="mt-0.5 text-sm text-amber">{s.error}</p>}
                    </div>
                    {["queued", "running", "paused"].includes(s.status) && (
                      <div className="flex gap-2">
                        <form action={setSearchStatus}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="to" value={s.status === "paused" ? "resume" : "pause"} />
                          <SubmitButton className="btn-quiet text-xs" pendingText="…">
                            {s.status === "paused" ? "Resume" : "Pause"}
                          </SubmitButton>
                        </form>
                        <form action={setSearchStatus}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="to" value="cancel" />
                          <ConfirmSubmit question="Cancel this job? Businesses already found stay on the list." className="btn-quiet text-xs hover:text-rose">
                            Cancel
                          </ConfirmSubmit>
                        </form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={`Businesses (${total.toLocaleString()})`}>
          <form method="get" action="/leads" className="mb-3 flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="line" value={line} />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name / website / phone…" className="field w-56" />
            {(ov?.per_state.length ?? 0) > 1 && (
              <select name="state" defaultValue={sp.state ?? ""} className="field w-auto">
                <option value="">All states</option>
                {ov!.per_state.map((r) => (
                  <option key={r.state} value={r.state}>
                    {r.state}
                  </option>
                ))}
              </select>
            )}
            {trades.length > 0 && (
              <select name="trade" defaultValue={sp.trade ?? ""} className="field w-auto max-w-[12rem]">
                <option value="">All trades</option>
                {trades.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
            <select name="size" defaultValue={sp.size ?? ""} className="field w-auto">
              <option value="">All tiers</option>
              <option value="high">High · likely 5+</option>
              <option value="medium">Medium · maybe 5+</option>
              <option value="low">Low · likely small</option>
            </select>
            <select name="exported" defaultValue={sp.exported ?? ""} className="field w-auto">
              <option value="">Exported or not</option>
              <option value="yes">Exported</option>
              <option value="no">Not exported</option>
            </select>
            <select name="status" defaultValue={sp.status ?? "all"} className="field w-auto">
              <option value="all">All customer statuses</option>
              <option value="prospect">Prospect</option>
              <option value="contacted">Contacted</option>
              <option value="replied">Replied</option>
              <option value="customer">Customer</option>
              <option value="not_interested">Not interested</option>
              <option value="do_not_contact">Do not contact</option>
            </select>
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" name="verified" value="1" defaultChecked={sp.verified === "1"} /> Verified email only
            </label>
            <button className="btn-quiet">Filter</button>
          </form>

          {/* Export, like WellThree's Export CSV: the filtered list, named as a campaign so it's tracked. */}
          <form method="get" action="/leads/export" className="mb-3 flex flex-wrap items-end gap-2 rounded border border-line bg-white/[0.02] p-3 text-sm">
            <input type="hidden" name="line" value={line} />
            {(["status", "size", "state", "trade", "exported", "q"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
            <input name="campaign" placeholder="Campaign name (optional)" className="field w-56" />
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" name="mark" value="1" defaultChecked /> Mark as exported
            </label>
            <button className="btn">Export CSV</button>
            <span className="text-xs text-faint">
              Uses the filters above. Only {hasBouncer ? "deliverable" : "working"} emails go in, never active clients, customers, Not interested or Do not contact.
            </span>
          </form>

          {leads.length === 0 ? (
            <Empty>{ov?.businesses ? "No businesses match these filters." : "Businesses show up here as searches run."}</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-line">
              {leads.map((m) => {
                const b = m.lead_businesses;
                const band = sizeBand(b.size_score);
                const v = b.email_verification ? VERIFY[b.email_verification] : null;
                return (
                  <li key={b.id} className="flex flex-wrap items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{b.name}</span>
                        <Chip tone={band.tone}>{band.text}</Chip>
                        {b.excluded_reason && <Chip tone="rose">{b.excluded_reason}</Chip>}
                        {b.company_id && !b.excluded_reason && (
                          <Link href={`/companies/${b.company_id}`} className="chip border-cyan/40 text-cyan">
                            In Companies
                          </Link>
                        )}
                        {m.exported_at && (
                          <Chip>
                            Exported {shortDate(m.exported_at)}
                            {m.campaign ? ` · ${m.campaign}` : ""}
                          </Chip>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted">
                        {[b.category, [b.city, b.state].filter(Boolean).join(", "), b.county].filter(Boolean).join(" · ")}
                        {b.review_count ? ` · ${b.rating ?? ""}★ ${b.review_count} reviews` : ""}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        {b.primary_email ? (
                          <>
                            <span className={b.email_status === "no_mx" ? "text-amber" : "text-ink"} title={b.emails.join(", ")}>
                              {b.primary_email}
                              {b.email_status === "no_mx" ? " (domain doesn't take mail)" : ""}
                              {b.emails.length > 1 ? ` +${b.emails.length - 1}` : ""}
                            </span>
                            {b.email_source && <span className="text-faint">from {b.email_source}</span>}
                            {v ? <Chip tone={v.tone}>{v.text}</Chip> : hasBouncer && <span className="text-faint">checking…</span>}
                          </>
                        ) : (
                          <span className="text-faint">
                            {b.enrich_status === "pending" || b.enrich_status === "running"
                              ? "Reading website…"
                              : b.fb_status === "pending" || b.fb_status === "running"
                                ? "Checking Facebook…"
                                : b.website
                                  ? "No email on the website"
                                  : "No website"}
                          </span>
                        )}
                        {b.owner_name && (
                          <span className="text-muted">
                            {b.owner_name}
                            {b.owner_title ? `, ${b.owner_title}` : ""}
                          </span>
                        )}
                        {b.phone && <span className="text-muted">{b.phone}</span>}
                        {b.website && (
                          <a href={b.website} target="_blank" rel="noreferrer" className="link">
                            {b.domain ?? "Website"}
                          </a>
                        )}
                        {b.facebook_url && (
                          <a href={b.facebook_url} target="_blank" rel="noreferrer" className="link">
                            FB
                          </a>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-faint">
                        Discovered {shortDate(b.created_at)}
                        {b.enriched_at ? ` · enriched ${shortDate(b.enriched_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {line === "local" && !b.company_id && (
                        <form action={addToCompanies}>
                          <input type="hidden" name="business" value={b.id} />
                          <SubmitButton className="btn-quiet text-xs" pendingText="Adding…">
                            Add to Companies
                          </SubmitButton>
                        </form>
                      )}
                      <LeadStatus business={b.id} line={line} status={m.status} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {total > PER_PAGE && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted">
              <span>
                Page {page} of {Math.ceil(total / PER_PAGE)}
              </span>
              <span className="flex gap-3">
                {page > 1 && (
                  <Link href={qs({ page: String(page - 1) })} className="link">
                    ← Prev
                  </Link>
                )}
                {page * PER_PAGE < total && (
                  <Link href={qs({ page: String(page + 1) })} className="link">
                    Next →
                  </Link>
                )}
              </span>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
