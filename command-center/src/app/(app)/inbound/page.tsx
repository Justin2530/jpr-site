import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ChevronIcon, MailIcon, PhoneIcon } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import { LINE_LABEL } from "@/lib/leads-shared";
import { parseHiringRequest } from "./parse";
import { addLeadToCompanies, dismissLead, reopenLead } from "./actions";

export const metadata = { title: "Leads · JPR" };

// Leads: employers who reached out (the website's hiring form) or answered JPR's outreach (texts and emails
// from contacts who aren't at a client company, and Lead Engine businesses marked Replied). Newest first.
export default async function InboundLeads() {
  const { supabase } = await requireStaff();
  const since = new Date(new Date().getTime() - 60 * 86400_000).toISOString();

  const [{ data: requests }, { data: inbound }, { data: replied }] = await Promise.all([
    supabase
      .from("action_items")
      .select("id, title, detail, status, created_at, company_id, contact_id, companies(name)")
      .eq("kind", "website_lead")
      .like("title", "Hiring request:%")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("activities")
      .select("id, kind, summary, body, occurred_at, contact_id, contacts!inner(id, full_name, email, phone, company_id, companies(id, name, status))")
      .in("kind", ["text", "email"])
      .eq("direction", "in")
      .not("contact_id", "is", null)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(500),
    supabase
      .from("lead_list_members")
      .select("line, status_changed_at, lead_businesses!inner(id, name, city, state, phone, primary_email, owner_name, company_id)")
      .eq("status", "replied")
      .order("status_changed_at", { ascending: false })
      .limit(100),
  ]);

  // One row per person, their latest message. Client contacts are clients, not leads.
  const people = new Map<string, NonNullable<typeof inbound>[number]>();
  for (const a of inbound ?? []) {
    if (a.contacts?.companies?.status === "client") continue;
    if (!people.has(a.contact_id!)) people.set(a.contact_id!, a);
  }

  // Everything in one list, newest first: name and company on each row, the rest when it's clicked
  // (Justin 2026-10-29: "i just want a list with name and company"). Requests already handled sit at the end.
  type Lead = { key: string; name: string; company: string | null; when: string | null; source: string; handled?: string; body: React.ReactNode };
  const leads: Lead[] = [];
  for (const r of requests ?? []) {
    const l = parseHiringRequest(r.title, r.detail);
    const handled = r.status === "open" ? undefined : r.company_id ? "In Companies" : "Not a lead";
    leads.push({
      key: `w:${r.id}`,
      name: l.name,
      company: r.companies?.name ?? l.company,
      when: r.created_at,
      source: l.nationwide ? "Website (nationwide)" : "Website",
      handled,
      body: (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {l.position && <Chip tone="cyan">{l.position}</Chip>}
            {l.location && <Chip>{l.location}</Chip>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {l.email && (
              <a href={`mailto:${l.email}`} className="link inline-flex items-center gap-1">
                <MailIcon className="h-3.5 w-3.5" />
                {l.email}
              </a>
            )}
            {l.phone && (
              <a href={`tel:${l.phone}`} className="link inline-flex items-center gap-1">
                <PhoneIcon className="h-3.5 w-3.5" />
                {l.phone}
                {l.smsOk && <span className="text-faint"> (OK to text)</span>}
              </a>
            )}
          </div>
          {l.message && <p className="whitespace-pre-line text-sm text-muted">{l.message}</p>}
          <div className="flex flex-wrap gap-2">
            {r.company_id ? (
              <Link href={`/companies/${r.company_id}`} className="btn px-3 py-1.5 text-xs">
                Open company
              </Link>
            ) : r.status === "open" ? (
              <>
                <form action={addLeadToCompanies}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn px-3 py-1.5 text-xs" pendingText="Adding…">
                    Add to Companies
                  </SubmitButton>
                </form>
                <form action={dismissLead}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn-quiet px-3 py-1.5 text-xs" pendingText="…">
                    Not a lead
                  </SubmitButton>
                </form>
              </>
            ) : (
              <form action={reopenLead}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton className="btn-quiet px-3 py-1.5 text-xs" pendingText="…">
                  Undo Not a lead
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
      ),
    });
  }
  for (const a of people.values()) {
    const c = a.contacts;
    leads.push({
      key: `p:${a.contact_id}`,
      name: c?.full_name ?? c?.email ?? c?.phone ?? "Unknown",
      company: c?.companies?.name ?? null,
      when: a.occurred_at,
      source: a.kind === "text" ? "Texted you" : "Emailed you",
      body: (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {c?.email && (
              <a href={`mailto:${c.email}`} className="link inline-flex items-center gap-1">
                <MailIcon className="h-3.5 w-3.5" />
                {c.email}
              </a>
            )}
            {c?.phone && (
              <a href={`tel:${c.phone}`} className="link inline-flex items-center gap-1">
                <PhoneIcon className="h-3.5 w-3.5" />
                {c.phone}
              </a>
            )}
          </div>
          <p className="whitespace-pre-line text-muted">{(a.body ?? a.summary ?? "").slice(0, 600)}</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/contacts/${a.contact_id}`} className="btn px-3 py-1.5 text-xs">
              Open contact
            </Link>
            {c?.companies && (
              <Link href={`/companies/${c.companies.id}`} className="btn-quiet px-3 py-1.5 text-xs">
                Open company
              </Link>
            )}
          </div>
        </div>
      ),
    });
  }
  for (const m of replied ?? []) {
    const b = m.lead_businesses;
    leads.push({
      key: `e:${b.id}:${m.line}`,
      name: b.owner_name ?? b.name,
      company: b.owner_name ? b.name : null,
      when: m.status_changed_at,
      source: `Lead Engine · ${LINE_LABEL[m.line]}`,
      body: (
        <div className="space-y-2 text-sm">
          <p className="text-muted">{[b.city, b.state].filter(Boolean).join(", ")}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {b.primary_email && (
              <a href={`mailto:${b.primary_email}`} className="link inline-flex items-center gap-1">
                <MailIcon className="h-3.5 w-3.5" />
                {b.primary_email}
              </a>
            )}
            {b.phone && (
              <a href={`tel:${b.phone}`} className="link inline-flex items-center gap-1">
                <PhoneIcon className="h-3.5 w-3.5" />
                {b.phone}
              </a>
            )}
          </div>
          {b.company_id && (
            <Link href={`/companies/${b.company_id}`} className="btn px-3 py-1.5 text-xs">
              Open company
            </Link>
          )}
        </div>
      ),
    });
  }
  const byNewest = (x: Lead, y: Lead) => (y.when ?? "").localeCompare(x.when ?? "");
  const active = leads.filter((l) => !l.handled).sort(byNewest);
  const done = leads.filter((l) => l.handled).sort(byNewest);

  const row = (l: Lead) => (
    <li key={l.key}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-1 py-2.5 [&::-webkit-details-marker]:hidden">
          <ChevronIcon className="h-3.5 w-3.5 shrink-0 -rotate-90 text-faint transition group-open:rotate-0" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{l.name}</span>
            {l.company && <span className="text-muted"> · {l.company}</span>}
          </span>
          <span className="hidden shrink-0 text-xs text-faint sm:inline">{l.handled ?? l.source}</span>
          <span className="shrink-0 font-mono text-[11px] text-faint">{timeAgo(l.when)}</span>
        </summary>
        <div className="pb-3 pl-7">
          <p className="mb-2 text-xs text-faint sm:hidden">{l.handled ?? l.source}</p>
          {l.body}
        </div>
      </details>
    </li>
  );

  return (
    <>
      <PageHeader title="Leads" sub="Employers who reached out to JPR or answered its outreach, newest first. Click one for everything on them." />
      <Panel title="Leads" action={<span className="readout text-xs text-cyan">{active.length}</span>}>
        {active.length === 0 ? <Empty>No leads right now.</Empty> : <ul className="divide-y divide-line">{active.map(row)}</ul>}
        {done.length > 0 && (
          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm text-muted">Handled ({done.length})</summary>
            <ul className="mt-1 divide-y divide-line">{done.map(row)}</ul>
          </details>
        )}
      </Panel>
    </>
  );
}
