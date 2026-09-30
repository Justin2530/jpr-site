import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { Chip, Empty, Panel } from "@/components/ui";
import { StageSelect } from "@/components/stage-select";
import { SubmissionEditor } from "@/components/submission-editor";
import { draftSubmission } from "@/lib/submission";
import { label, shortDate, STAGE_LABEL, STAGE_TONE, timeAgo, type Tone } from "@/lib/format";

type Candidate = Database["public"]["Tables"]["candidates"]["Row"];
type Line = { speaker: "agent" | "candidate"; text: string; at?: number };

const SUBMISSION_STATE: Record<Database["public"]["Enums"]["submission_status"], { text: string; tone: Tone }> = {
  draft: { text: "Waiting on you", tone: "amber" },
  sent: { text: "Sent", tone: "mint" },
  held: { text: "On hold", tone: "muted" },
  passed: { text: "Passed", tone: "rose" },
};

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function lines(transcript: Json): Line[] {
  return Array.isArray(transcript) ? (transcript as Line[]).filter((l) => l && typeof l.text === "string") : [];
}

// Everything about one candidate for one job: the submission waiting on Justin, what the AI call learned,
// the call itself with its transcript, and the activity for this job.
export async function JobWorkspace({
  supabase,
  candidate,
  cjId,
}: {
  supabase: SupabaseClient<Database>;
  candidate: Candidate;
  cjId: string;
}) {
  const { data: cj } = await supabase
    .from("candidate_jobs")
    .select(
      "id, stage, stage_changed_at, assigned_at, jobs(id, title, company_id, hiring_contact_id, location, compensation, schedule, companies(id, name))",
    )
    .eq("id", cjId)
    .eq("candidate_id", candidate.id)
    .maybeSingle();
  if (!cj?.jobs) return <Empty>That job isn&apos;t linked to this candidate anymore.</Empty>;
  const job = cj.jobs;

  const [{ data: runs }, { data: facts }, { data: goals }, { data: subs }, { data: contacts }, { data: activity }] = await Promise.all([
    supabase.from("screening_runs").select("*").eq("candidate_job_id", cj.id).order("created_at", { ascending: false }),
    supabase.from("screening_facts").select("*").eq("candidate_job_id", cj.id).order("sort"),
    supabase.from("screening_goals").select("id, prompt, required").eq("job_id", job.id).order("sort"),
    supabase.from("submissions").select("*").eq("candidate_job_id", cj.id).order("created_at", { ascending: false }).limit(1),
    supabase.from("contacts").select("id, full_name, title, email").eq("company_id", job.company_id).order("full_name"),
    supabase
      .from("activities")
      .select("id, kind, summary, occurred_at")
      .eq("candidate_id", candidate.id)
      .or(`candidate_job_id.eq.${cj.id},job_id.eq.${job.id}`)
      .order("occurred_at", { ascending: false })
      .limit(30),
  ]);

  const run = runs?.[0];
  const earlier = (runs ?? []).slice(1);
  const submission = subs?.[0];
  const people = contacts ?? [];
  const allFacts = facts ?? [];
  const byGoal = new Map(allFacts.filter((f) => f.goal_id).map((f) => [f.goal_id!, f]));
  const extraFacts = allFacts.filter((f) => !f.goal_id);
  const missing = (goals ?? []).filter((g) => g.required && !byGoal.get(g.id)?.value);

  const hiring =
    job.hiring_contact_id && people.some((p) => p.id === job.hiring_contact_id)
      ? [job.hiring_contact_id]
      : people.slice(0, 1).map((p) => p.id);
  const preselected = submission?.to_contact_ids.length ? submission.to_contact_ids : hiring;
  const template = draftSubmission({
    candidate,
    job,
    greetingName: people.find((p) => p.id === preselected[0])?.full_name,
    facts: [
      ...(goals ?? []).map((g) => ({ label: byGoal.get(g.id)?.label ?? g.prompt, value: byGoal.get(g.id)?.value ?? null })),
      ...extraFacts,
    ],
    notes: [],
  });
  const early = ["assigned", "contacting", "conversation"].includes(cj.stage);
  const state = submission ? SUBMISSION_STATE[submission.status] : null;

  return (
    <div className="space-y-6">
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <Link href={`/jobs/${job.id}`} className="link font-medium">
            {job.title}
          </Link>
          <p className="text-sm text-muted">
            <Link href={`/companies/${job.companies?.id}`} className="hover:text-cyan">
              {job.companies?.name}
            </Link>
            {[job.location, job.compensation].filter(Boolean).map((x) => ` · ${x}`)} · assigned {shortDate(cj.assigned_at)}
          </p>
        </div>
        <Chip tone={STAGE_TONE[cj.stage]}>{STAGE_LABEL[cj.stage]}</Chip>
        <StageSelect id={cj.id} stage={cj.stage} />
      </div>

      <section id="submission">
        <Panel
          title="Submission"
          action={
            <span className="flex items-center gap-2">
              {submission?.drafted_by === "ai" && <Chip tone="cyan">AI draft</Chip>}
              {state && <Chip tone={state.tone}>{state.text}</Chip>}
            </span>
          }
        >
          {submission?.status === "sent" && (
            <p className="mb-3 text-sm text-mint">
              Sent {shortDate(submission.sent_at)} to{" "}
              {people
                .filter((p) => submission.to_contact_ids.includes(p.id))
                .map((p) => p.full_name)
                .join(", ") || "the client"}
              .
            </p>
          )}
          {!submission && early ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted">
                No draft yet. The AI writes one after the pre-submission call. <span className="text-cyan">Write one now</span>
              </summary>
              <div className="mt-4">
                <SubmissionEditor
                  candidateJobId={cj.id}
                  contacts={people}
                  preselected={preselected}
                  subject={template.subject}
                  body={template.body}
                />
              </div>
            </details>
          ) : (
            <SubmissionEditor
              key={submission?.updated_at ?? "new"}
              candidateJobId={cj.id}
              submissionId={submission?.id}
              contacts={people}
              preselected={preselected}
              subject={submission?.subject || template.subject}
              body={submission?.body || template.body}
              locked={submission?.status === "sent"}
            />
          )}
        </Panel>
      </section>

      <Panel title="What we learned" action={missing.length > 0 && <Chip tone="amber">{missing.length} required still open</Chip>}>
        {(goals ?? []).length === 0 && extraFacts.length === 0 ? (
          <Empty>No screening goals on this job yet.</Empty>
        ) : (
          <dl className="divide-y divide-line">
            {(goals ?? []).map((g) => {
              const f = byGoal.get(g.id);
              return (
                <div key={g.id} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                  <dt className="text-sm text-muted">
                    {f?.label ?? g.prompt}
                    {g.required && <span className="ml-1 text-amber">*</span>}
                  </dt>
                  <dd className="text-sm">
                    {f?.value ? f.value : <span className={g.required ? "text-amber" : "text-faint"}>Not answered yet</span>}
                  </dd>
                </div>
              );
            })}
            {extraFacts.map((f) => (
              <div key={f.id} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                <dt className="text-sm text-muted">{f.label}</dt>
                <dd className="text-sm">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>

      <Panel
        title="Pre-submission call"
        action={
          run && (
            <span className="flex items-center gap-2 font-mono text-[11px] text-faint">
              {run.started_at && shortDate(run.started_at)}
              {run.duration_seconds != null && ` · ${clock(run.duration_seconds)}`}
              <Chip tone={run.status === "completed" ? "mint" : run.status === "no_answer" || run.status === "failed" ? "rose" : "muted"}>
                {label(run.status)}
              </Chip>
            </span>
          )
        }
      >
        {!run ? (
          <Empty>No call yet. The AI calls after you assign a candidate, once calling goes live in phase 4.</Empty>
        ) : (
          <div className="space-y-4">
            {run.summary && <p className="text-sm leading-relaxed">{run.summary}</p>}
            {[
              { title: "Their questions", items: run.candidate_questions, tone: "text-cyan" },
              { title: "Possible concerns", items: run.concerns, tone: "text-amber" },
              { title: "Still unresolved", items: run.unresolved, tone: "text-rose" },
            ]
              .filter((b) => b.items.length > 0)
              .map((b) => (
                <div key={b.title}>
                  <p className={`panel-title mb-1.5 ${b.tone}`}>{b.title}</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {b.items.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              ))}
            {run.recording_url && (
              <audio controls src={run.recording_url} className="w-full">
                <a href={run.recording_url}>Recording</a>
              </audio>
            )}
            {lines(run.transcript).length > 0 && (
              <details className="rounded-lg border border-line">
                <summary className="cursor-pointer px-3 py-2 text-sm text-cyan">Transcript ({lines(run.transcript).length} lines)</summary>
                <ol className="max-h-[28rem] space-y-2.5 overflow-auto border-t border-line p-3">
                  {lines(run.transcript).map((l, i) => (
                    <li key={i} className={`flex gap-3 ${l.speaker === "candidate" ? "flex-row-reverse text-right" : ""}`}>
                      <span className="w-10 shrink-0 pt-0.5 font-mono text-[10.5px] text-faint">{l.at != null ? clock(l.at) : ""}</span>
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${l.speaker === "agent" ? "border border-cyan/25 bg-cyan-soft" : "border border-line bg-white/[0.03]"}`}
                      >
                        <p className="panel-title mb-0.5 text-[10px]">
                          {l.speaker === "agent" ? "JPR assistant" : candidate.full_name.split(" ")[0]}
                        </p>
                        {l.text}
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {earlier.length > 0 && (
              <p className="font-mono text-[11px] text-faint">
                Earlier attempts:{" "}
                {earlier.map((r) => `${r.started_at ? shortDate(r.started_at) : shortDate(r.created_at)} ${label(r.status)}`).join(" · ")}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Activity for this job">
        {(activity ?? []).length === 0 ? (
          <Empty>Nothing logged for this job yet.</Empty>
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-4">
            {activity!.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-cyan/60 bg-void" />
                <p className="text-sm">{a.summary}</p>
                <p className="font-mono text-[10.5px] text-faint">
                  {label(a.kind)} · {timeAgo(a.occurred_at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
