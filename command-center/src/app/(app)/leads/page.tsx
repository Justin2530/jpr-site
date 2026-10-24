import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { timeAgo, type Tone } from "@/lib/format";
import { LINE_LABEL, SERPER_FREE_CREDITS, sizeBand, type LeadLine } from "@/lib/leads-shared";
import type { Enums } from "@/lib/database.types";
import { addToCompanies, setSearchStatus } from "./actions";
import { LeadStatus } from "./lead-status";
import { NewSearch } from "./new-search";

export const metadata = { title: "Lead Engine · JPR" };

const PER_PAGE = 50;
const SEARCH_TONE: Record<Enums<"lead_search_status">, Tone> = { queued: "cyan", running: "cyan", paused: "amber", done: "mint", canceled: "muted" };
const LINE_NOTE: Record<LeadLine, string> = {
  local: "Employers in and around Jefferson County for JPR's recruiting emails.",
  usa: "Machine shops and manufacturers nationwide for JPR USA.",
  ai: "Businesses for JPR AI's audit emails. The list stays here as a download; nothing is sent to the AI system.",
};

type Search = { line?: string; status?: string; email?: string; size?: string; county?: string; q?: string; page?: string };

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

  const base = () => supabase.from("lead_list_members").select("business_id, lead_businesses!inner(id)", { count: "exact", head: true }).eq("line", line);
  let list = supabase
    .from("lead_list_members")
    .select(
      "status, exported_at, created_at, lead_businesses!inner(id, name, category, address, city, county, state, phone, website, facebook_url, primary_email, emails, email_status, owner_name, owner_title, size_score, rating, review_count, enrich_status, excluded_reason, company_id)",
      { count: "exact" },
    )
    .eq("line", line)
    .order("created_at", { ascending: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  if (sp.status && sp.status !== "all") list = list.eq("status", sp.status as Enums<"lead_status">);
  if (sp.email === "1") list = list.not("lead_businesses.primary_email", "is", null);
  if (sp.size === "likely") list = list.gte("lead_businesses.size_score", 50);
  if (sp.size === "maybe") list = list.gte("lead_businesses.size_score", 30);
  if (sp.county) list = list.eq("lead_businesses.county", sp.county);
  if (sp.q) list = list.ilike("lead_businesses.name", `%${sp.q.replace(/[%_,()]/g, " ").trim()}%`);

  const [listRes, all, withEmail, likely, searchesRes, creditsRes] = await Promise.all([
    list,
    base(),
    base().eq("lead_businesses.email_status", "mx_ok").is("lead_businesses.excluded_reason", null),
    base().gte("lead_businesses.size_score", 50),
    supabase.from("lead_searches").select("*").eq("line", line).order("created_at", { ascending: false }).limit(12),
    supabase.from("lead_searches").select("credits_used"),
  ]);
  if (listRes.error) throw new Error(listRes.error.message);
  const leads = listRes.data ?? [];
  const total = listRes.count ?? 0;
  const searches = searchesRes.data ?? [];
  const creditsUsed = (creditsRes.data ?? []).reduce((s, r) => s + r.credits_used, 0);
  const hasKey = !!process.env.SERPER_API_KEY?.trim();
  const counties = [...new Set(searches.flatMap((s) => (s.areas as { county: string }[]).map((a) => a.county)))].sort();
  const reading = searches.some((s) => s.status === "running" || s.status === "queued");

  const qs = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, line, ...over })) if (v) p.set(k, String(v));
    return `/leads?${p}`;
  };
  const exportQs = new URLSearchParams({ line, ...(sp.size === "likely" ? { size: "likely" } : {}), ...(sp.county ? { county: sp.county } : {}) });

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Lead Engine"
        sub="Finds businesses on Google Maps by county and keyword, then reads their websites for emails. Nothing is ever sent from here."
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

      {!hasKey && (
        <p className="mb-4 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
          Searches are waiting on the Serper key (SERPER_API_KEY in Vercel). Everything else works.
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${LINE_LABEL[line]} leads`} value={(all.count ?? 0).toLocaleString()} />
        <Stat label="With a working email" value={(withEmail.count ?? 0).toLocaleString()} tone="mint" />
        <Stat label="Likely 5+ employees" value={(likely.count ?? 0).toLocaleString()} />
        <Stat
          label={`Serper credits used (${SERPER_FREE_CREDITS.toLocaleString()} free)`}
          value={creditsUsed.toLocaleString()}
          tone={creditsUsed > SERPER_FREE_CREDITS ? "amber" : "cyan"}
        />
      </div>

      <div className="space-y-6">
        <Panel title="Searches" action={reading ? <span className="text-xs text-muted">Runs in the background every 2 minutes</span> : undefined}>
          {searches.length === 0 ? (
            <Empty>No {LINE_LABEL[line]} searches yet. Start one below.</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-line">
              {searches.map((s) => {
                const pct = s.task_count ? Math.min(100, Math.round(((s.credits_used + s.failed_count) / Math.max(s.task_count, 1)) * 100)) : 0;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        <Chip tone={SEARCH_TONE[s.status]}>{s.status}</Chip>
                      </div>
                      <p className="mt-0.5 text-sm text-muted">
                        {s.new_count.toLocaleString()} new businesses · {s.credits_used.toLocaleString()} of up to {s.max_credits.toLocaleString()} credits
                        {s.status === "running" || s.status === "queued" ? ` · about ${pct}% through` : ""}
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
                          <ConfirmSubmit question="Stop this search? Businesses already found stay on the list." className="btn-quiet text-xs hover:text-rose">
                            Stop
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

        <details className="panel" open={searches.length === 0}>
          <summary className="cursor-pointer px-4 py-3 panel-title">New search</summary>
          <div className="border-t border-line p-4">
            <NewSearch line={line} hasKey={hasKey} creditsUsed={creditsUsed} freeCredits={SERPER_FREE_CREDITS} />
          </div>
        </details>

        <Panel
          title={`Leads (${total.toLocaleString()})`}
          action={
            <div className="flex flex-wrap gap-2 text-xs">
              <a href={`/leads/export?${exportQs}`} className="btn-quiet">
                Download CSV
              </a>
              <a href={`/leads/export?${exportQs}&mark=1`} className="btn-quiet">
                Download and mark exported
              </a>
            </div>
          }
        >
          <form method="get" action="/leads" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="line" value={line} />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Business name" className="field w-44" />
            <select name="status" defaultValue={sp.status ?? "all"} className="field w-auto">
              <option value="all">Any status</option>
              <option value="prospect">Prospect</option>
              <option value="contacted">Contacted</option>
              <option value="replied">Replied</option>
              <option value="customer">Customer</option>
              <option value="not_interested">Not interested</option>
              <option value="do_not_contact">Do not contact</option>
            </select>
            <select name="size" defaultValue={sp.size ?? ""} className="field w-auto">
              <option value="">Any size</option>
              <option value="likely">Likely 5+</option>
              <option value="maybe">Maybe 5+ or more</option>
            </select>
            {counties.length > 1 && (
              <select name="county" defaultValue={sp.county ?? ""} className="field w-auto">
                <option value="">Every county</option>
                {counties.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" name="email" value="1" defaultChecked={sp.email === "1"} /> Has email
            </label>
            <button className="btn-quiet">Filter</button>
          </form>
          <p className="mb-3 text-xs text-faint">
            The CSV has only leads with a working email, never active clients, customers, &quot;Not interested&quot; or &quot;Do not contact&quot;. Size is a guess from Google
            (reviews, a website, the kind of business), not a headcount.
          </p>

          {leads.length === 0 ? (
            <Empty>{all.count ? "No leads match these filters." : "Leads show up here as searches run."}</Empty>
          ) : (
            <ul className="-my-1 divide-y divide-line">
              {leads.map((m) => {
                const b = m.lead_businesses;
                const band = sizeBand(b.size_score);
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
                        {m.exported_at && <Chip>Exported {timeAgo(m.exported_at)}</Chip>}
                      </div>
                      <p className="mt-0.5 text-sm text-muted">
                        {[b.category, [b.city, b.state].filter(Boolean).join(", "), b.county].filter(Boolean).join(" · ")}
                        {b.review_count ? ` · ${b.rating ?? ""}★ ${b.review_count} reviews` : ""}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm">
                        {b.primary_email ? (
                          <span className={b.email_status === "mx_ok" ? "text-ink" : "text-amber"} title={b.emails.join(", ")}>
                            {b.primary_email}
                            {b.email_status === "no_mx" ? " (domain doesn't take mail)" : ""}
                            {b.emails.length > 1 ? ` +${b.emails.length - 1}` : ""}
                          </span>
                        ) : (
                          <span className="text-faint">
                            {b.enrich_status === "pending" || b.enrich_status === "running" ? "Reading website…" : b.website ? "No email on the website" : "No website"}
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
                            Website
                          </a>
                        )}
                        {b.facebook_url && (
                          <a href={b.facebook_url} target="_blank" rel="noreferrer" className="link">
                            Facebook
                          </a>
                        )}
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
                {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total.toLocaleString()}
              </span>
              <span className="flex gap-3">
                {page > 1 && (
                  <Link href={qs({ page: String(page - 1) })} className="link">
                    Previous
                  </Link>
                )}
                {page * PER_PAGE < total && (
                  <Link href={qs({ page: String(page + 1) })} className="link">
                    Next
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
