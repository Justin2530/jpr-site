import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel } from "@/components/ui";
import { Board, type BoardCard } from "@/components/board";
import { StageSelect } from "@/components/stage-select";
import { ViewSwitcher } from "@/components/view-switcher";
import { daysSince, STAGE_LABEL, STAGE_TONE, timeAgo } from "@/lib/format";
import { Constants, type Enums } from "@/lib/database.types";
import { moveCandidateJob } from "../pipeline-actions";

export const metadata = { title: "Pipeline · JPR" };

const MAIN: Enums<"pipeline_stage">[] = ["applied", "assigned", "contacting", "conversation", "ready_to_submit", "submitted", "interviewing", "offer", "placed"];
const CLOSED: Enums<"pipeline_stage">[] = ["on_hold", "passed", "withdrawn"];
const STALE_DAYS = 7;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; job?: string; closed?: string }>;
}) {
  const { view = "board", job, closed } = await searchParams;
  const showClosed = closed === "1";
  const { supabase } = await requireStaff();

  const [{ data: rows, error }, { data: jobs }] = await Promise.all([
    (() => {
      let q = supabase
        .from("candidate_jobs")
        .select("id, stage, stage_changed_at, candidates(id, full_name, current_title), jobs(id, title, companies(name))")
        .order("stage_changed_at", { ascending: false })
        .limit(1000);
      if (job) q = q.eq("job_id", job);
      if (!showClosed) q = q.not("stage", "in", `(${CLOSED.join(",")})`);
      return q;
    })(),
    supabase.from("jobs").select("id, title, companies(name)").eq("status", "open").order("title"),
  ]);
  if (error) throw new Error(error.message);

  // Keep the Placed column to recent wins unless closed items are shown.
  const visible = (rows ?? []).filter((r) => showClosed || r.stage !== "placed" || daysSince(r.stage_changed_at) <= 60);
  const stages = showClosed ? [...MAIN, ...CLOSED] : MAIN;
  const params = { job, closed };

  const cards: BoardCard[] = visible.map((r) => ({
    id: r.id,
    column: r.stage,
    title: r.candidates?.full_name ?? "Unknown",
    href: `/candidates/${r.candidates?.id}?job=${r.id}`,
    sub: job ? r.candidates?.current_title ?? undefined : `${r.jobs?.title} · ${r.jobs?.companies?.name}`,
    meta: `${timeAgo(r.stage_changed_at)} in stage`,
    flag: r.stage !== "placed" && daysSince(r.stage_changed_at) >= STALE_DAYS,
  }));

  return (
    <>
      <PageHeader
        kicker="Recruiting"
        title="Pipeline"
        sub={`Every candidate in every job. A red dot means no movement in ${STALE_DAYS}+ days.`}
        action={
          <ViewSwitcher
            basePath="/pipeline"
            current={view}
            params={params}
            options={[
              { key: "board", label: "Board" },
              { key: "list", label: "List" },
            ]}
          />
        }
      />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value={view} />
        <select name="job" defaultValue={job ?? ""} className="field w-auto min-w-56" aria-label="Filter by job">
          <option value="">All open jobs</option>
          {(jobs ?? []).map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} · {j.companies?.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" name="closed" value="1" defaultChecked={showClosed} className="accent-cyan" />
          Show on hold, passed, withdrawn
        </label>
        <button className="btn-quiet">Apply</button>
      </form>

      {visible.length === 0 ? (
        <Empty>
          Nobody in the pipeline yet. Open a{" "}
          <Link href="/jobs" className="link text-cyan">
            job
          </Link>{" "}
          and assign candidates to it.
        </Empty>
      ) : view === "list" ? (
        <Panel>
          <div className="-m-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Candidate", "Job", "Company", "Stage", "In stage", ""].map((h) => (
                    <th key={h} className="panel-title px-4 py-2.5 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...visible]
                  .sort((a, b) => Constants.public.Enums.pipeline_stage.indexOf(a.stage) - Constants.public.Enums.pipeline_stage.indexOf(b.stage))
                  .map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5">
                        <Link href={`/candidates/${r.candidates?.id}?job=${r.id}`} className="link font-medium">
                          {r.candidates?.full_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/jobs/${r.jobs?.id}`} className="link text-muted">
                          {r.jobs?.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{r.jobs?.companies?.name}</td>
                      <td className="px-4 py-2.5">
                        <Chip tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Chip>
                      </td>
                      <td className={`px-4 py-2.5 font-mono text-xs ${daysSince(r.stage_changed_at) >= STALE_DAYS && r.stage !== "placed" ? "text-rose" : "text-faint"}`}>
                        {timeAgo(r.stage_changed_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StageSelect id={r.id} stage={r.stage} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <Board
          columns={stages.map((s) => ({ key: s, label: STAGE_LABEL[s], tone: STAGE_TONE[s] }))}
          cards={cards}
          move={moveCandidateJob}
        />
      )}
    </>
  );
}
