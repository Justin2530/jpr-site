import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, Field, PageHeader, Panel, Row } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MailIcon, PhoneIcon, PlusIcon } from "@/components/icons";
import { DEAL_STAGE_LABEL, DEAL_STAGE_TONE, label, shortDate, timeAgo, type Tone } from "@/lib/format";
import { CompanyFields } from "../company-fields";
import { addAgreement, addContact, deleteContact, setAgreementStatus, updateCompany } from "../actions";

const STATUS_TONE: Record<string, Tone> = { client: "mint", prospect: "cyan", former_client: "muted", active: "mint", draft: "cyan", ended: "muted" };

function money(n: number | null) {
  return n === null ? null : `$${Number(n).toLocaleString("en-US")}`;
}

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff();
  const [{ data: c }, { data: contacts }, { data: agreements }, { data: jobs }, { data: activity }, { data: deals }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("*").eq("company_id", id).order("full_name"),
    supabase.from("agreements").select("*").eq("company_id", id).order("created_at", { ascending: false }),
    supabase.from("jobs").select("id, title, status, candidate_jobs(id)").eq("company_id", id).order("created_at", { ascending: false }),
    supabase.from("activities").select("id, summary, occurred_at, candidate_id, candidates(full_name)").eq("company_id", id).order("occurred_at", { ascending: false }).limit(15),
    supabase.from("deals").select("id, title, stage, value").eq("company_id", id).order("updated_at", { ascending: false }),
  ]);
  if (!c) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const activeAgreement = agreements?.find((a) => a.status === "active" && (!a.end_date || a.end_date >= today));

  return (
    <>
      <PageHeader
        kicker={<Link href="/companies" className="hover:text-cyan">Companies</Link>}
        title={c.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={STATUS_TONE[c.status]}>{label(c.status)}</Chip>
            {activeAgreement && <Chip tone="rose">Protected: no outreach to their employees</Chip>}
          </span>
        }
        action={
          <Link href={`/jobs/new?company=${c.id}`} className="btn">
            <PlusIcon className="h-4 w-4" /> New job
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Panel title="Jobs">
            {(jobs ?? []).length === 0 ? (
              <Empty>No jobs for this company yet.</Empty>
            ) : (
              <ul className="-my-1 divide-y divide-line">
                {jobs!.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 py-2.5">
                    <Link href={`/jobs/${j.id}`} className="link flex-1 font-medium">
                      {j.title}
                    </Link>
                    <span className="font-mono text-xs text-muted">{j.candidate_jobs.length} candidates</span>
                    <Chip tone={j.status === "open" ? "cyan" : "muted"}>{label(j.status)}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Deals"
            action={
              <Link href={`/deals/new?company=${c.id}`} className="text-xs text-cyan">
                + New deal
              </Link>
            }
          >
            {(deals ?? []).length === 0 ? (
              <Empty>No deals yet.</Empty>
            ) : (
              <ul className="-my-1 divide-y divide-line">
                {deals!.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2.5">
                    <Link href={`/deals/${d.id}`} className="link flex-1 font-medium">
                      {d.title}
                    </Link>
                    <span className="readout text-sm">{money(d.value)}</span>
                    <Chip tone={DEAL_STAGE_TONE[d.stage]}>{DEAL_STAGE_LABEL[d.stage]}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Agreements">
            {(agreements ?? []).length > 0 && (
              <ul className="-mt-1 mb-4 divide-y divide-line">
                {agreements!.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {a.plan_name ?? label(a.type)}{" "}
                        <span className="text-sm font-normal text-muted">
                          {a.type === "subscription"
                            ? [money(a.monthly_price) && `${money(a.monthly_price)}/mo`, a.search_capacity && `${a.search_capacity} searches`].filter(Boolean).join(" · ")
                            : a.fee_percent !== null && `${a.fee_percent}% of first-year compensation`}
                        </span>
                      </p>
                      <p className="font-mono text-[11px] text-faint">
                        {a.start_date ? shortDate(a.start_date) : "No start"} → {a.end_date ? shortDate(a.end_date) : "open-ended"}
                      </p>
                    </div>
                    <Chip tone={STATUS_TONE[a.status]}>{a.status}</Chip>
                    <form action={setAgreementStatus} className="flex gap-1">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="company_id" value={c.id} />
                      {a.status !== "active" && (
                        <button name="status" value="active" className="btn-quiet px-2 py-1 text-xs">
                          Activate
                        </button>
                      )}
                      {a.status !== "ended" && (
                        <button name="status" value="ended" className="btn-quiet px-2 py-1 text-xs">
                          End
                        </button>
                      )}
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <details className="group">
              <summary className="cursor-pointer text-sm text-cyan">+ Add agreement</summary>
              <form action={addAgreement} className="mt-4 grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="company_id" value={c.id} />
                <Field label="Type" name="type">
                  <select id="type" name="type" className="field">
                    <option value="subscription">Subscription</option>
                    <option value="contingency">Contingency</option>
                  </select>
                </Field>
                <Field label="Status" name="agr_status">
                  <select id="agr_status" name="status" className="field">
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                  </select>
                </Field>
                <Field label="Plan name" name="plan_name">
                  <input id="plan_name" name="plan_name" className="field" placeholder="e.g. Up to 3 searches" />
                </Field>
                <Field label="Monthly price ($)" name="monthly_price">
                  <input id="monthly_price" name="monthly_price" inputMode="decimal" className="field" />
                </Field>
                <Field label="Searches included" name="search_capacity">
                  <input id="search_capacity" name="search_capacity" inputMode="numeric" className="field" />
                </Field>
                <Field label="Contingency fee (%)" name="fee_percent">
                  <input id="fee_percent" name="fee_percent" inputMode="decimal" className="field" />
                </Field>
                <Field label="Start" name="start_date">
                  <input id="start_date" name="start_date" type="date" className="field" />
                </Field>
                <Field label="End" name="end_date">
                  <input id="end_date" name="end_date" type="date" className="field" />
                </Field>
                <Field label="Notes" name="agr_notes" className="sm:col-span-2">
                  <textarea id="agr_notes" name="notes" rows={2} className="field" />
                </Field>
                <div>
                  <SubmitButton>Save agreement</SubmitButton>
                </div>
              </form>
            </details>
          </Panel>

          <Panel title="Activity">
            {(activity ?? []).length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {activity!.map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <span className="w-16 shrink-0 font-mono text-[11px] text-faint">{timeAgo(a.occurred_at)}</span>
                    <span>
                      {a.candidates?.full_name && (
                        <Link href={`/candidates/${a.candidate_id}`} className="link font-medium">
                          {a.candidates.full_name}
                        </Link>
                      )}{" "}
                      <span className="text-muted">{a.summary}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Contacts">
            {(contacts ?? []).length === 0 && <p className="mb-3 text-sm text-faint">No contacts yet.</p>}
            <ul className="-mt-1 mb-3 divide-y divide-line">
              {(contacts ?? []).map((p) => (
                <li key={p.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/contacts/${p.id}`} className="link font-medium">
                        {p.full_name}
                      </Link>
                      {p.title && <p className="text-sm text-muted">{p.title}</p>}
                    </div>
                    <form action={deleteContact}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="company_id" value={c.id} />
                      <button className="text-xs text-faint hover:text-rose" aria-label={`Remove ${p.full_name}`}>
                        Remove
                      </button>
                    </form>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-sm">
                    {p.phone && (
                      <a href={`tel:${p.phone}`} className="link inline-flex items-center gap-1.5 text-muted">
                        <PhoneIcon className="h-3.5 w-3.5" /> {p.phone}
                      </a>
                    )}
                    {p.email && (
                      <a href={`mailto:${p.email}`} className="link inline-flex items-center gap-1.5 text-muted">
                        <MailIcon className="h-3.5 w-3.5" /> {p.email}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <details>
              <summary className="cursor-pointer text-sm text-cyan">+ Add contact</summary>
              <form action={addContact} className="mt-3 space-y-3">
                <input type="hidden" name="company_id" value={c.id} />
                <input name="full_name" required placeholder="Name" className="field" aria-label="Contact name" />
                <input name="title" placeholder="Title" className="field" aria-label="Contact title" />
                <input name="email" type="email" placeholder="Email" className="field" aria-label="Contact email" />
                <input name="phone" type="tel" placeholder="Phone" className="field" aria-label="Contact phone" />
                <SubmitButton>Add contact</SubmitButton>
              </form>
            </details>
          </Panel>

          <Panel title="Details">
            <dl>
              <Row label="Industry">{c.industry}</Row>
              <Row label="City">{c.city}</Row>
              <Row label="Phone">{c.phone && <a href={`tel:${c.phone}`} className="link">{c.phone}</a>}</Row>
              <Row label="Website">{c.website}</Row>
              <Row label="Notes">{c.notes && <span className="whitespace-pre-wrap">{c.notes}</span>}</Row>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-cyan">Edit details</summary>
              <form action={updateCompany} className="mt-3 space-y-4">
                <input type="hidden" name="id" value={c.id} />
                <CompanyFields c={c} />
                <SubmitButton>Save changes</SubmitButton>
              </form>
            </details>
          </Panel>
        </div>
      </div>
    </>
  );
}
