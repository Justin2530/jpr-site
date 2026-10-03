import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { automationState } from "@/lib/automation-state";
import { Chip, Empty, PageHeader, Panel, Row } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StageSelect } from "@/components/stage-select";
import { ShieldIcon } from "@/components/icons";
import { daysSince, label, STAGE_LABEL, STAGE_TONE, timeAgo } from "@/lib/format";
import { Board } from "@/components/board";
import { ViewSwitcher } from "@/components/view-switcher";
import { Constants } from "@/lib/database.types";
import { JobFields } from "../job-fields";
import { addGoal, deleteGoal, setJobStatus, toggleGoal, updateJob } from "../actions";
import { assignToJob, moveCandidateJob, unassign } from "../../pipeline-actions";

export default async function JobDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view = "list" } = await searchParams;
  const { supabase } = await requireStaff();
  const [{ data: job }, { data: pipeline }, { data: goals }, { data: companies }, { data: contacts }, { data: pool }] = await Promise.all([
    supabase.from("jobs").select("*, companies(id, name), contacts(full_name, email, phone)").eq("id", id).maybeSingle(),
    supabase
      .from("candidate_jobs")
      .select("id, stage, stage_changed_at, candidates(id, full_name, current_title, current_employer, phone)")
      .eq("job_id", id)
      .order("stage_changed_at", { ascending: false }),
    supabase.from("screening_goals").select("*").eq("job_id", id).order("sort"),
    supabase.from("companies").select("id, name").order("name"),
    supabase.from("contacts").select("id, full_name, company_id").order("full_name"),
    supabase.from("candidates").select("id, full_name, current_title, created_at").order("updated_at", { ascending: false }).limit(500),
  ]);
  if (!job) notFound();

  const rows = pipeline ?? [];
  const assigned = new Set(rows.map((r) => r.candidates?.id));
  const available = (pool ?? []).filter((c) => !assigned.has(c.id));
  const automation = await automationState(supabase);
  const protectedChecks = await Promise.all(
    rows.map((r) =>
      r.candidates?.current_employer
        ? supabase.rpc("is_protected_employer", { employer: r.candidates.current_employer }).then((x) => Boolean(x.data))
        : Promise.resolve(false),
    ),
  );
  const order = Constants.public.Enums.pipeline_stage;
  const sorted = rows
    .map((r, i) => ({ ...r, isProtected: protectedChecks[i] }))
    .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));

  return (
    <>
      <PageHeader
        kicker={
          <Link href={`/companies/${job.companies?.id}`} className="hover:text-cyan">
            {job.companies?.name}
          </Link>
        }
        title={job.title}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={job.status === "open" ? "cyan" : "muted"}>{label(job.status)}</Chip>
            {job.priority === 1 && <Chip tone="amber">High priority</Chip>}
            {job.visibility !== "private" && <Chip>{label(job.visibility)}</Chip>}
            <span>{[job.location, job.compensation, job.schedule].filter(Boolean).join(" · ")}</span>
          </span>
        }
        action={
          <form action={setJobStatus} className="flex gap-2">
            <input type="hidden" name="id" value={job.id} />
            {job.status !== "open" && (
              <button name="status" value="open" className="btn-quiet">
                Reopen
              </button>
            )}
            {job.status === "open" && (
              <>
                <button name="status" value="on_hold" className="btn-quiet">
                  Hold
                </button>
                <button name="status" value="filled" className="btn-quiet">
                  Mark filled
                </button>
              </>
            )}
          </form>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Panel
            title={`Pipeline · ${rows.length}`}
            action={
              <ViewSwitcher
                basePath={`/jobs/${job.id}`}
                current={view}
                options={[
                  { key: "list", label: "List" },
                  { key: "board", label: "Board" },
                ]}
              />
            }
          >
            <form action={assignToJob} className="mb-4 flex flex-wrap gap-2 sm:flex-nowrap">
              <input type="hidden" name="job_id" value={job.id} />
              <select name="candidate_id" required defaultValue="" className="field" aria-label="Candidate to assign">
                <option value="" disabled>
                  {available.length ? "Choose a candidate to assign…" : "No unassigned candidates yet"}
                </option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                    {c.current_title ? ` · ${c.current_title}` : ""}
                    {automation.on && !automation.eligible(c.created_at) ? " · manual only" : ""}
                  </option>
                ))}
              </select>
              <SubmitButton className={automation.on ? "btn-quiet shrink-0" : "btn shrink-0"} pendingText="Assigning…">
                Assign only
              </SubmitButton>
              {automation.on && (
                <SubmitButton className="btn shrink-0" name="automate" value="on" pendingText="Assigning…">
                  Assign + automate
                </SubmitButton>
              )}
            </form>
            {sorted.length > 0 && view === "board" ? (
              <Board
                columns={Constants.public.Enums.pipeline_stage.map((st) => ({ key: st, label: STAGE_LABEL[st], tone: STAGE_TONE[st] }))}
                cards={sorted.map((r) => ({
                  id: r.id,
                  column: r.stage,
                  title: r.candidates?.full_name ?? "",
                  href: `/candidates/${r.candidates?.id}?job=${r.id}`,
                  sub: [r.candidates?.current_title, r.candidates?.current_employer].filter(Boolean).join(" at ") || undefined,
                  meta: `${timeAgo(r.stage_changed_at)} in stage`,
                  flag: r.isProtected || (r.stage !== "placed" && daysSince(r.stage_changed_at) >= 7),
                }))}
                move={moveCandidateJob}
              />
            ) : sorted.length === 0 ? (
              <Empty>
                No candidates yet.{" "}
                <Link href={`/candidates/new?job=${job.id}`} className="link text-cyan">
                  Add a new candidate
                </Link>{" "}
                or assign an existing one above.
              </Empty>
            ) : (
              <ul className="-mb-1 divide-y divide-line">
                {sorted.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/candidates/${r.candidates?.id}?job=${r.id}`} className="link font-medium">
                          {r.candidates?.full_name}
                        </Link>
                        {r.isProtected && (
                          <span title="Works at an active client" className="text-rose">
                            <ShieldIcon className="h-4 w-4" />
                          </span>
                        )}
                        <Chip tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Chip>
                      </div>
                      <p className="truncate text-sm text-muted">
                        {[r.candidates?.current_title, r.candidates?.current_employer].filter(Boolean).join(" at ")}
                      </p>
                    </div>
                    <span className="font-mono text-[11px] text-faint">{timeAgo(r.stage_changed_at)}</span>
                    {!["submitted", "interviewing", "offer", "placed", "passed", "withdrawn"].includes(r.stage) && (
                      <Link
                        href={`/candidates/${r.candidates?.id}?job=${r.id}#submission`}
                        className={r.stage === "ready_to_submit" ? "btn py-1 text-xs" : "btn-quiet py-1 text-xs"}
                      >
                        {r.stage === "ready_to_submit" ? "Review submission" : "Submit to client"}
                      </Link>
                    )}
                    <StageSelect id={r.id} stage={r.stage} />
                    <form action={unassign}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-xs text-faint hover:text-rose" aria-label="Remove from job">
                        ✕
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Screening goals">
            <p className="-mt-1 mb-3 text-sm text-muted">
              What the pre-submission call has to learn. <span className="text-amber">Required</span> goals must be answered before a
              submission is drafted.
            </p>
            {(goals ?? []).length === 0 && <Empty>No goals yet.</Empty>}
            <ul className="space-y-2">
              {(goals ?? []).map((g) => (
                <li key={g.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="flex-1 text-sm">{g.prompt}</span>
                  <form action={toggleGoal}>
                    <input type="hidden" name="id" value={g.id} />
                    <input type="hidden" name="job_id" value={job.id} />
                    <input type="hidden" name="required" value={String(!g.required)} />
                    <button title="Switch required / nice to know">
                      <Chip tone={g.required ? "amber" : "muted"}>{g.required ? "Required" : "Nice to know"}</Chip>
                    </button>
                  </form>
                  <form action={deleteGoal}>
                    <input type="hidden" name="id" value={g.id} />
                    <input type="hidden" name="job_id" value={job.id} />
                    <button className="text-xs text-faint hover:text-rose" aria-label="Delete goal">
                      ✕
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={addGoal} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="job_id" value={job.id} />
              <input
                name="prompt"
                placeholder="Add something the call needs to find out…"
                className="field flex-1"
                aria-label="New screening goal"
              />
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" name="required" defaultChecked className="accent-cyan" /> Required
              </label>
              <SubmitButton className="btn-quiet">Add</SubmitButton>
            </form>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Details">
            <dl>
              <Row label="Hiring contact">
                {job.contacts && (
                  <span>
                    {job.contacts.full_name}
                    {job.contacts.phone && (
                      <a href={`tel:${job.contacts.phone}`} className="link block text-muted">
                        {job.contacts.phone}
                      </a>
                    )}
                  </span>
                )}
              </Row>
              <Row label="Opened">{timeAgo(job.opened_on)}</Row>
              <Row label="Description">{job.description && <span className="whitespace-pre-wrap">{job.description}</span>}</Row>
              <Row label="Can share">
                {job.candidate_description && <span className="whitespace-pre-wrap">{job.candidate_description}</span>}
              </Row>
              <Row label="Internal">
                {job.internal_notes && <span className="whitespace-pre-wrap text-amber">{job.internal_notes}</span>}
              </Row>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-cyan">Edit job</summary>
              <form action={updateJob} className="mt-3 space-y-4">
                <input type="hidden" name="id" value={job.id} />
                <JobFields job={job} companies={companies ?? []} contacts={contacts ?? []} />
                <SubmitButton>Save changes</SubmitButton>
              </form>
            </details>
          </Panel>
        </div>
      </div>
    </>
  );
}
