import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel, Row } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StageSelect } from "@/components/stage-select";
import { MailIcon, PhoneIcon, ShieldIcon } from "@/components/icons";
import { SOURCE_LABEL, STAGE_LABEL, STAGE_TONE, shortDate, timeAgo } from "@/lib/format";
import { CandidateFields } from "../candidate-fields";
import { addNote, updateCandidate } from "../actions";
import { JobWorkspace } from "./job-workspace";
import { ResumePanel } from "./resume-panel";
import { assignToJob, unassign } from "../../pipeline-actions";

const KIND_LABEL: Record<string, string> = {
  note: "Note",
  call: "Call",
  text: "Text",
  email: "Email",
  assigned: "Assigned",
  stage: "Stage",
};

export default async function CandidateDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { id } = await params;
  const { job: jobTab } = await searchParams;
  const { supabase } = await requireStaff();
  const [{ data: c }, { data: links }, { data: resumes }, { data: activity }, { data: openJobs }] = await Promise.all([
    supabase.from("candidates").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("candidate_jobs")
      .select("id, stage, stage_changed_at, assigned_at, jobs(id, title, companies(name))")
      .eq("candidate_id", id)
      .order("assigned_at", { ascending: false }),
    supabase.from("resumes").select("*").eq("candidate_id", id).order("created_at", { ascending: false }),
    supabase
      .from("activities")
      .select("id, kind, summary, occurred_at, staff(full_name, email)")
      .eq("candidate_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase.from("jobs").select("id, title, companies(name)").eq("status", "open").order("title"),
  ]);
  if (!c) notFound();

  const { data: isProtected } = c.current_employer
    ? await supabase.rpc("is_protected_employer", { employer: c.current_employer })
    : { data: false };

  const signed = await Promise.all(
    (resumes ?? []).map(async (r) => {
      if (!r.storage_path) return r;
      const [view, download] = await Promise.all([
        supabase.storage.from("resumes").createSignedUrl(r.storage_path, 60 * 30),
        supabase.storage.from("resumes").createSignedUrl(r.storage_path, 60 * 30, { download: r.file_name }),
      ]);
      return { ...r, viewUrl: view.data?.signedUrl, downloadUrl: download.data?.signedUrl };
    }),
  );

  const assignedIds = new Set((links ?? []).map((l) => l.jobs?.id));
  const assignable = (openJobs ?? []).filter((j) => !assignedIds.has(j.id));
  const activeTab = (links ?? []).find((l) => l.id === jobTab)?.id;

  return (
    <>
      <PageHeader
        kicker={
          <Link href="/candidates" className="hover:text-cyan">
            Candidates
          </Link>
        }
        title={c.full_name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span>{[c.current_title, c.current_employer && `at ${c.current_employer}`].filter(Boolean).join(" ")}</span>
            <Chip>{SOURCE_LABEL[c.source]}</Chip>
            {c.contact_consent ? <Chip tone="mint">OK to contact</Chip> : <Chip tone="amber">No contact consent on file</Chip>}
          </span>
        }
        action={
          <div className="flex gap-2">
            {c.phone && (
              <a href={`tel:${c.phone}`} className="btn-quiet">
                <PhoneIcon className="h-4 w-4" /> Call
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="btn-quiet">
                <MailIcon className="h-4 w-4" /> Email
              </a>
            )}
          </div>
        }
      />

      {isProtected && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose/40 bg-rose/10 px-4 py-3 text-sm">
          <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose" />
          <p>
            <span className="font-medium text-rose">Works at an active client.</span>{" "}
            <span className="text-ink/90">
              We recruit for our clients, not from them. Don&apos;t reach out proactively while that agreement is active.
            </span>
          </p>
        </div>
      )}

      {(links ?? []).length > 0 && (
        <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Jobs for this candidate">
          <Link
            href={`/candidates/${c.id}`}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${!activeTab ? "border-cyan/50 bg-cyan-soft text-cyan" : "border-line text-muted hover:text-ink"}`}
          >
            Overview
          </Link>
          {links!.map((l) => (
            <Link
              key={l.id}
              href={`/candidates/${c.id}?job=${l.id}`}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${activeTab === l.id ? "border-cyan/50 bg-cyan-soft text-ink" : "border-line text-muted hover:text-ink"}`}
            >
              <span className="max-w-[16rem] truncate">{l.jobs?.title}</span>
              <Chip tone={STAGE_TONE[l.stage]}>{STAGE_LABEL[l.stage]}</Chip>
            </Link>
          ))}
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {activeTab ? (
          <JobWorkspace supabase={supabase} candidate={c} cjId={activeTab} />
        ) : (
          <div className="space-y-6">
            <Panel title="Jobs">
              <form action={assignToJob} className="mb-4 flex gap-2">
                <input type="hidden" name="candidate_id" value={c.id} />
                <select name="job_id" required defaultValue="" className="field" aria-label="Job to assign">
                  <option value="" disabled>
                    {assignable.length ? "Choose an open job…" : "No other open jobs"}
                  </option>
                  {assignable.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} · {j.companies?.name}
                    </option>
                  ))}
                </select>
                <SubmitButton className="btn shrink-0" pendingText="Assigning…">
                  Assign to job
                </SubmitButton>
              </form>
              {(links ?? []).length === 0 ? (
                <Empty>Not assigned to any job yet.</Empty>
              ) : (
                <ul className="-mb-1 divide-y divide-line">
                  {links!.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link href={`/candidates/${c.id}?job=${l.id}`} className="link font-medium">
                            {l.jobs?.title}
                          </Link>
                          <Chip tone={STAGE_TONE[l.stage]}>{STAGE_LABEL[l.stage]}</Chip>
                        </div>
                        <p className="text-sm text-muted">
                          {l.jobs?.companies?.name} · assigned {shortDate(l.assigned_at)}
                        </p>
                      </div>
                      <StageSelect id={l.id} stage={l.stage} />
                      <form action={unassign}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="text-xs text-faint hover:text-rose" aria-label="Remove from job">
                          ✕
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Timeline">
              <form action={addNote} className="mb-5 flex flex-wrap gap-2">
                <input type="hidden" name="candidate_id" value={c.id} />
                <select name="kind" defaultValue="note" className="field w-28" aria-label="Type">
                  <option value="note">Note</option>
                  <option value="call">Call</option>
                  <option value="text">Text</option>
                  <option value="email">Email</option>
                </select>
                <input name="summary" required placeholder="What happened?" className="field min-w-0 flex-1" aria-label="Timeline entry" />
                <SubmitButton className="btn-quiet">Log</SubmitButton>
              </form>
              {(activity ?? []).length === 0 ? (
                <Empty>Nothing logged yet.</Empty>
              ) : (
                <ol className="relative space-y-4 border-l border-line pl-4">
                  {activity!.map((a) => (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-cyan/60 bg-void" />
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone={a.kind === "stage" || a.kind === "assigned" ? "cyan" : "muted"}>{KIND_LABEL[a.kind] ?? a.kind}</Chip>
                        <span className="font-mono text-[10.5px] text-faint">
                          {timeAgo(a.occurred_at)}
                          {a.staff && ` · ${a.staff.full_name ?? a.staff.email.split("@")[0]}`}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{a.summary}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>
        )}

        <div className="space-y-6">
          <ResumePanel candidateId={c.id} resumes={signed} />

          <Panel title="Contact">
            <dl>
              <Row label="Phone">
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="link">
                    {c.phone}
                  </a>
                )}
              </Row>
              <Row label="Email">
                {c.email && (
                  <a href={`mailto:${c.email}`} className="link">
                    {c.email}
                  </a>
                )}
              </Row>
              <Row label="Location">{[c.city, c.state].filter(Boolean).join(", ")}</Row>
              <Row label="LinkedIn">
                {c.linkedin_url && (
                  <a
                    href={c.linkedin_url.startsWith("http") ? c.linkedin_url : `https://${c.linkedin_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link"
                  >
                    Profile
                  </a>
                )}
              </Row>
              <Row label="Consent">
                {c.contact_consent ? `${c.contact_consent_note ?? "Yes"} (${shortDate(c.contact_consent_at)})` : "None recorded"}
              </Row>
              <Row label="Notes">{c.notes && <span className="whitespace-pre-wrap">{c.notes}</span>}</Row>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-cyan">Edit candidate</summary>
              <form action={updateCandidate} className="mt-3 space-y-4">
                <input type="hidden" name="id" value={c.id} />
                <CandidateFields c={c} />
                <SubmitButton>Save changes</SubmitButton>
              </form>
            </details>
          </Panel>
        </div>
      </div>
    </>
  );
}
