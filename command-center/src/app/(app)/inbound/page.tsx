import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MailIcon, PhoneIcon } from "@/components/icons";
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

  const fresh = (requests ?? []).filter((r) => r.status === "open");
  const handled = (requests ?? []).filter((r) => r.status !== "open");

  // One row per person, their latest message. Client contacts are clients, not leads.
  const people = new Map<string, NonNullable<typeof inbound>[number]>();
  for (const a of inbound ?? []) {
    if (a.contacts?.companies?.status === "client") continue;
    if (!people.has(a.contact_id!)) people.set(a.contact_id!, a);
  }

  return (
    <>
      <PageHeader
        title="Leads"
        sub="Employers who reached out to JPR or answered its outreach, newest first. The Lead Engine's lists are the cold ones."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="From the website" action={<span className="readout text-xs text-cyan">{fresh.length} new</span>}>
          {fresh.length === 0 ? (
            <Empty>No new hiring requests.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {fresh.map((r) => {
                const l = parseHiringRequest(r.title, r.detail);
                return (
                  <li key={r.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">
                        {l.name}
                        {l.company && <span className="text-muted"> · {l.company}</span>}
                      </p>
                      <span className="font-mono text-[11px] text-faint">{timeAgo(r.created_at)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {l.nationwide && <Chip tone="amber">Nationwide page</Chip>}
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
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {handled.length > 0 && (
            <details className="mt-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-sm text-muted">Handled ({handled.length})</summary>
              <ul className="mt-2 divide-y divide-line">
                {handled.map((r) => {
                  const l = parseHiringRequest(r.title, r.detail);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        {r.company_id ? (
                          <Link href={`/companies/${r.company_id}`} className="link">
                            {r.companies?.name ?? l.company ?? l.name}
                          </Link>
                        ) : (
                          <span className="text-muted">
                            {l.name}
                            {l.company && ` · ${l.company}`}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <Chip tone={r.company_id ? "mint" : "muted"}>{r.company_id ? "In Companies" : "Not a lead"}</Chip>
                        <span className="font-mono text-[11px] text-faint">{timeAgo(r.created_at)}</span>
                        {!r.company_id && (
                          <form action={reopenLead}>
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton className="btn-quiet px-2 py-0.5 text-[11px]" pendingText="…">
                              Undo
                            </SubmitButton>
                          </form>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Replied to you" action={<span className="readout text-xs text-cyan">{people.size}</span>}>
            {people.size === 0 ? (
              <Empty>Nobody outside your clients has texted or emailed in the last 60 days.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {[...people.values()].map((a) => (
                  <li key={a.contact_id} className="py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/contacts/${a.contact_id}`} className="link font-medium">
                        {a.contacts?.full_name ?? a.contacts?.email ?? a.contacts?.phone}
                      </Link>
                      <span className="font-mono text-[11px] text-faint">{timeAgo(a.occurred_at)}</span>
                    </div>
                    <p className="text-sm text-muted">
                      {a.contacts?.companies?.name && (
                        <Link href={`/companies/${a.contacts.companies.id}`} className="link">
                          {a.contacts.companies.name}
                        </Link>
                      )}
                      {a.contacts?.companies?.name && " · "}
                      {a.kind === "text" ? "Text" : "Email"}: {(a.summary ?? a.body ?? "").slice(0, 160)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Lead Engine replies" action={<span className="readout text-xs text-cyan">{(replied ?? []).length}</span>}>
            {(replied ?? []).length === 0 ? (
              <Empty>No Lead Engine businesses marked Replied yet. Mark one on its card in the Lead Engine when they answer.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {(replied ?? []).map((m) => {
                  const b = m.lead_businesses;
                  return (
                    <li key={`${b.id}-${m.line}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                      <span>
                        {b.company_id ? (
                          <Link href={`/companies/${b.company_id}`} className="link font-medium">
                            {b.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{b.name}</span>
                        )}
                        <span className="text-muted">
                          {" "}
                          · {[b.city, b.state].filter(Boolean).join(", ")}
                          {b.owner_name && ` · ${b.owner_name}`}
                          {b.primary_email && ` · ${b.primary_email}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Chip>{LINE_LABEL[m.line]}</Chip>
                        <span className="font-mono text-[11px] text-faint">{timeAgo(m.status_changed_at)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
