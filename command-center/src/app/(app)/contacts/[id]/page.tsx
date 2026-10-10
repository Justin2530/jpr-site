import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel, Row } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { PlusIcon } from "@/components/icons";
import { ReachOut } from "@/components/reach-out";
import { twilioReady } from "@/lib/twilio";
import { gmailAccount } from "@/lib/gmail-account";
import { Correspondence } from "@/components/correspondence";
import { Reminders } from "@/components/reminders";
import { contactCorrespondence } from "@/lib/correspondence";
import { DEAL_STAGE_LABEL, DEAL_STAGE_TONE, label, money } from "@/lib/format";
import { ContactFields } from "../contact-fields";
import { removeContact, updateContact } from "../actions";

export default async function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff();
  const [{ data: c }, { data: deals }, { data: jobs }, { data: companies }] = await Promise.all([
    supabase.from("contacts").select("*, companies!contacts_company_id_fkey(id, name, status)").eq("id", id).maybeSingle(),
    supabase.from("deals").select("id, title, stage, value").eq("contact_id", id).order("updated_at", { ascending: false }),
    supabase.from("jobs").select("id, title, status").eq("hiring_contact_id", id).order("created_at", { ascending: false }),
    supabase.from("companies").select("id, name").order("name"),
  ]);
  if (!c) notFound();
  const path = `/contacts/${c.id}`;
  const [history, { data: reminders }] = await Promise.all([
    contactCorrespondence(supabase, c.id),
    supabase
      .from("action_items")
      .select("id, title, due_on")
      .eq("contact_id", c.id)
      .eq("status", "open")
      .order("due_on", { nullsFirst: false }),
  ]);

  return (
    <>
      <PageHeader
        kicker={
          <Link href="/contacts" className="hover:text-cyan">
            Contacts
          </Link>
        }
        title={c.full_name}
        sub={
          <span>
            {c.title && `${c.title} at `}
            <Link href={`/companies/${c.companies?.id}`} className="link">
              {c.companies?.name}
            </Link>
          </span>
        }
        action={
          <ReachOut
            phone={c.phone}
            email={c.email}
            name={c.full_name}
            links={{ contact_id: c.id, company_id: c.company_id }}
            path={path}
            twilio={twilioReady()}
            gmail={Boolean(await gmailAccount())}
            optedOut={Boolean(c.sms_opted_out_at)}
          />
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Panel title={`Correspondence · ${history.length}`}>
            <Correspondence items={history} />
          </Panel>
          <Panel
            title="Deals"
            action={
              <Link href={`/deals/new?company=${c.company_id}`} className="text-xs text-cyan">
                <PlusIcon className="inline h-3.5 w-3.5" /> New deal
              </Link>
            }
          >
            {(deals ?? []).length === 0 ? (
              <Empty>No deals with this contact.</Empty>
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
          <Panel title="Jobs they're hiring for">
            {(jobs ?? []).length === 0 ? (
              <Empty>Not the hiring contact on any job.</Empty>
            ) : (
              <ul className="-my-1 divide-y divide-line">
                {jobs!.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 py-2.5">
                    <Link href={`/jobs/${j.id}`} className="link flex-1 font-medium">
                      {j.title}
                    </Link>
                    <Chip tone={j.status === "open" ? "cyan" : "muted"}>{label(j.status)}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Details">
            <dl>
              <Row label="Phone">{c.phone}</Row>
              <Row label="Email">{c.email}</Row>
              <Row label="Notes">{c.notes && <span className="whitespace-pre-wrap">{c.notes}</span>}</Row>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-cyan">Edit contact</summary>
              <form action={updateContact} className="mt-3 space-y-4">
                <input type="hidden" name="id" value={c.id} />
                <ContactFields c={c} companies={companies ?? []} />
                <SubmitButton>Save changes</SubmitButton>
              </form>
              <form action={removeContact} className="mt-3">
                <input type="hidden" name="id" value={c.id} />
                <button className="text-xs text-faint hover:text-rose">Delete contact</button>
              </form>
            </details>
          </Panel>
          <Reminders items={reminders ?? []} links={{ contact_id: c.id, company_id: c.company_id }} path={path} />
        </div>
      </div>
    </>
  );
}
