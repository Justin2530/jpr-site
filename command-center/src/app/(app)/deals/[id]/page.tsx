import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel, Row } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MailIcon, PhoneIcon } from "@/components/icons";
import { ReachOut } from "@/components/reach-out";
import { twilioReady } from "@/lib/twilio";
import { Correspondence } from "@/components/correspondence";
import { dealCorrespondence } from "@/lib/correspondence";
import { DEAL_STAGE_LABEL, DEAL_STAGE_TONE, label, money, shortDate, timeAgo } from "@/lib/format";
import { Constants } from "@/lib/database.types";
import { DealFields } from "../deal-fields";
import { deleteDeal, logDealNote, setDealStage, updateDeal } from "../actions";

export default async function DealDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff();
  const [{ data: deal }, { data: activity }, { data: companies }, { data: contacts }] = await Promise.all([
    supabase
      .from("deals")
      .select("*, companies(id, name, status), contacts(full_name, title, phone, email, sms_opted_out_at)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("id, kind, summary, occurred_at")
      .eq("deal_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase.from("companies").select("id, name").order("name"),
    supabase.from("contacts").select("id, full_name, company_id").order("full_name"),
  ]);
  if (!deal) notFound();
  const history = await dealCorrespondence(supabase, deal.id, deal.contact_id);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = deal.next_step_on && deal.next_step_on <= today && !["won", "lost"].includes(deal.stage);

  return (
    <>
      <PageHeader
        kicker={
          <Link href="/deals" className="hover:text-cyan">
            Deals
          </Link>
        }
        title={deal.title}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={DEAL_STAGE_TONE[deal.stage]}>{DEAL_STAGE_LABEL[deal.stage]}</Chip>
            <Link href={`/companies/${deal.companies?.id}`} className="link">
              {deal.companies?.name}
            </Link>
            {deal.value !== null && <span className="readout text-cyan">{money(deal.value)}</span>}
          </span>
        }
        action={
          deal.contacts && (
            <ReachOut
              phone={deal.contacts.phone}
              email={deal.contacts.email}
              name={deal.contacts.full_name}
              twilio={twilioReady()}
              optedOut={Boolean(deal.contacts.sms_opted_out_at)}
              links={{ deal_id: deal.id, contact_id: deal.contact_id ?? undefined, company_id: deal.company_id }}
              path={`/deals/${deal.id}`}
            />
          )
        }
      />

      <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${overdue ? "border-rose/40 bg-rose/10" : "border-line bg-panel"}`}>
        <span className="panel-title mr-2">Next step</span>
        {deal.next_step ? (
          <span>
            {deal.next_step}
            {deal.next_step_on && (
              <span className={`ml-2 font-mono text-xs ${overdue ? "text-rose" : "text-muted"}`}>due {shortDate(deal.next_step_on)}</span>
            )}
          </span>
        ) : (
          <span className="text-amber">None set. Add one below so this deal doesn&apos;t go quiet.</span>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {Constants.public.Enums.deal_stage.map((s) => (
          <form key={s} action={setDealStage}>
            <input type="hidden" name="id" value={deal.id} />
            <input type="hidden" name="stage" value={s} />
            <button
              className={`chip px-3 py-1 ${s === deal.stage ? "border-cyan/60 bg-cyan-soft text-cyan" : "border-line text-muted hover:text-ink"}`}
              disabled={s === deal.stage}
            >
              {DEAL_STAGE_LABEL[s]}
            </button>
          </form>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Panel title={`Correspondence${deal.contacts ? ` with ${deal.contacts.full_name}` : ""} · ${history.length}`}>
            <Correspondence items={history} />
          </Panel>
          <Panel title="Activity">
            <form action={logDealNote} className="mb-5 flex flex-wrap gap-2">
              <input type="hidden" name="deal_id" value={deal.id} />
              <select name="kind" defaultValue="call" className="field w-28" aria-label="Type">
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="meeting">Meeting</option>
                <option value="note">Note</option>
              </select>
              <input name="summary" required placeholder="What happened?" className="field min-w-0 flex-1" aria-label="Activity" />
              <SubmitButton className="btn-quiet">Log</SubmitButton>
            </form>
            {(activity ?? []).length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : (
              <ol className="relative space-y-4 border-l border-line pl-4">
                {activity!.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-cyan/60 bg-void" />
                    <div className="flex items-center gap-2">
                      <Chip tone={a.kind === "deal" ? "cyan" : "muted"}>{a.kind === "deal" ? "Stage" : label(a.kind)}</Chip>
                      <span className="font-mono text-[10.5px] text-faint">{timeAgo(a.occurred_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{a.summary}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Contact">
            {deal.contacts ? (
              <div className="text-sm">
                <p className="font-medium">{deal.contacts.full_name}</p>
                {deal.contacts.title && <p className="text-muted">{deal.contacts.title}</p>}
                <div className="mt-2 flex flex-wrap gap-3">
                  {deal.contacts.phone && (
                    <a href={`tel:${deal.contacts.phone}`} className="link inline-flex items-center gap-1.5 text-muted">
                      <PhoneIcon className="h-3.5 w-3.5" /> {deal.contacts.phone}
                    </a>
                  )}
                  {deal.contacts.email && (
                    <a href={`mailto:${deal.contacts.email}`} className="link inline-flex items-center gap-1.5 text-muted">
                      <MailIcon className="h-3.5 w-3.5" /> {deal.contacts.email}
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-faint">No contact picked.</p>
            )}
          </Panel>
          <Panel title="Details">
            <dl>
              <Row label="Type">{deal.deal_type && label(deal.deal_type)}</Row>
              <Row label="Value">{deal.value !== null && money(deal.value)}</Row>
              <Row label="Close by">{shortDate(deal.expected_close)}</Row>
              <Row label="Opened">{shortDate(deal.created_at)}</Row>
              <Row label="Notes">{deal.notes && <span className="whitespace-pre-wrap">{deal.notes}</span>}</Row>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-cyan">Edit deal</summary>
              <form action={updateDeal} className="mt-3 space-y-4">
                <input type="hidden" name="id" value={deal.id} />
                <DealFields deal={deal} companies={companies ?? []} contacts={contacts ?? []} />
                <SubmitButton>Save changes</SubmitButton>
              </form>
              <form action={deleteDeal} className="mt-3">
                <input type="hidden" name="id" value={deal.id} />
                <button className="text-xs text-faint hover:text-rose">Delete deal</button>
              </form>
            </details>
          </Panel>
        </div>
      </div>
    </>
  );
}
