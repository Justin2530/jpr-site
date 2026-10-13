"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { Constants, type Enums } from "@/lib/database.types";
import { beginOutreach } from "@/lib/outreach";
import { oldImportLinks } from "@/lib/old-imports";
import { OUTREACH_SOURCES, interviewWhen, type OutreachSource } from "@/lib/format";

const outreachSource = (form: FormData) => {
  const v = String(form.get("outreach_source") ?? "");
  return OUTREACH_SOURCES.some((o) => o.value === v)
    ? (v as OutreachSource)
    : null;
};

// Assigning a candidate to a job is the one human action that starts the workflow, and only when the
// person picks "Assign + automate" (or later flips the switch on the job tab).
export async function assignToJob(form: FormData) {
  const { supabase, userId, staff } = await requireStaff();
  const candidateId = String(form.get("candidate_id") ?? "");
  const jobId = String(form.get("job_id") ?? "");
  if (!candidateId || !jobId) return;
  const { data, error } = await supabase
    .from("candidate_jobs")
    .insert({
      candidate_id: candidateId,
      job_id: jobId,
      assigned_by: userId,
      outreach_source: outreachSource(form),
    })
    .select("id")
    .single();
  if (error && error.code !== "23505") throw new Error(error.message);
  if (data && form.get("automate") === "on")
    await beginOutreach(supabase, data.id, staff.role === "owner");
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}

export async function setStage(form: FormData) {
  const { supabase } = await requireStaff();
  const stage = String(form.get("stage")) as Enums<"pipeline_stage">;
  if (!Constants.public.Enums.pipeline_stage.includes(stage))
    throw new Error("Unknown stage");
  const { data, error } = await supabase
    .from("candidate_jobs")
    .update({ stage })
    .eq("id", String(form.get("id")))
    .select("id, candidate_id, job_id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/candidates/${data.candidate_id}`);
  revalidatePath(`/jobs/${data.job_id}`);
  revalidatePath("/");
}

export async function unassign(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  // An unsent reply draft filed on this job would block the removal; it goes too.
  await supabase.from("inbox_drafts").delete().eq("candidate_job_id", id);
  const { data, error } = await supabase
    .from("candidate_jobs")
    .delete()
    .eq("id", id)
    .select("candidate_id, job_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return; // already removed (a second press)
  revalidatePath(`/candidates/${data.candidate_id}`);
  revalidatePath(`/jobs/${data.job_id}`);
  revalidatePath("/");
}

// Board drag-and-drop: move one candidate-in-job to another stage.
export async function moveCandidateJob(id: string, stage: string) {
  const form = new FormData();
  form.set("id", id);
  form.set("stage", stage);
  await setStage(form);
}

// The per-job Automated recruiting switch on the candidate's job tab. Off pauses the schedule where
// it is; on picks it back up, or starts a fresh one if the last run already ended.
export async function setOutreach(form: FormData) {
  const { supabase, staff } = await requireStaff();
  const cjId = String(form.get("id") ?? "");
  const on = form.get("on") === "true";
  if (on) await beginOutreach(supabase, cjId, staff.role === "owner", true);
  else {
    const { error } = await supabase.rpc("set_outreach", {
      p_candidate_job_id: cjId,
      p_on: false,
    });
    if (error) throw new Error(error.message);
  }
  const { data } = await supabase
    .from("candidate_jobs")
    .select("candidate_id, job_id")
    .eq("id", cjId)
    .single();
  if (data) {
    revalidatePath(`/candidates/${data.candidate_id}`);
    revalidatePath(`/jobs/${data.job_id}`);
  }
  revalidatePath("/");
}

// "Call now" on the job tab: books the AI screening call for right now; the next tick dials it.
export async function callNow(form: FormData) {
  const { supabase } = await requireStaff();
  const cjId = String(form.get("id") ?? "");
  const { error } = await supabase.rpc("screening_call_now", {
    p_candidate_job_id: cjId,
  });
  if (error) throw new Error(error.message);
  const { data } = await supabase
    .from("candidate_jobs")
    .select("candidate_id")
    .eq("id", cjId)
    .single();
  if (data) revalidatePath(`/candidates/${data.candidate_id}`);
  revalidatePath("/");
}

// Justin takes a booked call himself (2026-10-13, Timothy Cox asked to talk with him directly): the AI call is
// cancelled and a reminder to call them at that time lands on What needs me.
export async function callMyself(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const runId = String(form.get("run") ?? "");
  const { data: run } = await supabase
    .from("screening_runs")
    .select("id, scheduled_for, status, candidate_job_id, candidate_jobs(candidate_id, candidates(full_name), jobs(id, title, company_id, market_id))")
    .eq("id", runId)
    .single();
  if (!run || run.status !== "scheduled") return;
  const { error } = await supabase.from("screening_runs").update({ status: "cancelled" }).eq("id", run.id).eq("status", "scheduled");
  if (error) throw new Error(error.message);
  const cj = run.candidate_jobs as unknown as {
    candidate_id: string;
    candidates: { full_name: string } | null;
    jobs: { id: string; title: string; company_id: string; market_id: string } | null;
  } | null;
  const when = run.scheduled_for ? interviewWhen(run.scheduled_for) : "";
  await supabase.from("action_items").insert({
    kind: "task",
    title: `Call ${cj?.candidates?.full_name ?? "them"}${when ? ` · ${when}` : ""}`,
    detail: `${cj?.jobs?.title ?? ""}. You're taking this call yourself; the AI assistant won't call.`,
    priority: 1,
    created_by: userId,
    due_on: run.scheduled_for
      ? new Date(run.scheduled_for).toLocaleDateString("en-CA", { timeZone: "America/New_York" })
      : null,
    candidate_id: cj?.candidate_id ?? null,
    candidate_job_id: run.candidate_job_id,
    job_id: cj?.jobs?.id ?? null,
    company_id: cj?.jobs?.company_id ?? null,
    market_id: cj?.jobs?.market_id ?? null,
  });
  if (cj) revalidatePath(`/candidates/${cj.candidate_id}`);
  revalidatePath("/");
  revalidatePath("/dashboard");
}

// The job's Automated recruiting switch: off pauses everyone on this job where they are, on picks them back up.
export async function setJobAutomation(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id") ?? "");
  const { error } = await supabase.rpc("set_job_automation", {
    p_job: id,
    p_on: form.get("on") === "true",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/pipeline");
  revalidatePath("/");
}

export async function clearOldImports() {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") throw new Error("Only the owner can do this");
  const ids = await oldImportLinks(supabase);
  if (!ids.length) return;
  await supabase.from("inbox_drafts").delete().in("candidate_job_id", ids);
  const { error } = await supabase
    .from("candidate_jobs")
    .delete()
    .in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

// Bulk actions from the checkboxes on job pages and the Pipeline list (Justin 2026-10-11).
const cleanIds = (ids: string[]) =>
  ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);

export async function bulkSetStage(
  ids: string[],
  stage: string,
): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireStaff();
  if (
    !Constants.public.Enums.pipeline_stage.includes(
      stage as Enums<"pipeline_stage">,
    )
  )
    return { ok: false, message: "Unknown stage." };
  const list = cleanIds(ids);
  const { data, error } = await supabase
    .from("candidate_jobs")
    .update({ stage: stage as Enums<"pipeline_stage"> })
    .in("id", list)
    .select("id");
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Moved ${data.length} to ${stage.replaceAll("_", " ")}.`,
  };
}

export async function bulkUnassign(
  ids: string[],
): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireStaff();
  const list = cleanIds(ids);
  await supabase.from("inbox_drafts").delete().in("candidate_job_id", list);
  const { data, error } = await supabase
    .from("candidate_jobs")
    .delete()
    .in("id", list)
    .select("id");
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: `Removed ${data.length} from the job.` };
}

// Justin types in (or changes) the interview time himself (2026-10-12). Saved as a confirmed interview, so it shows
// on the candidate and on the job; reminders and the client check-in still only go out when the three switches are on.
export async function setInterviewTime(cjId: string, iso: string, details: string): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(cjId)) return { ok: false, message: "Unknown candidate." };
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { ok: false, message: "Pick a date and time." };
  const note = details.trim().slice(0, 500) || null;
  const { data: current } = await supabase
    .from("interviews")
    .select("id, scheduled_at, status")
    .eq("candidate_job_id", cjId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fields = {
    status: "confirmed" as const,
    waiting_on: null,
    scheduled_at: at.toISOString(),
    details: note,
    confirmed_at: new Date().toISOString(),
    // A new time gets its own reminder and check-in.
    ...(current?.scheduled_at !== at.toISOString() ? { reminder_sent_at: null, checkin_sent_at: null } : {}),
  };
  const { error } =
    current && current.status !== "done"
      ? await supabase.from("interviews").update(fields).eq("id", current.id)
      : await supabase.from("interviews").insert({ candidate_job_id: cjId, ...fields });
  if (error) return { ok: false, message: error.message };
  const { data: cj } = await supabase.from("candidate_jobs").select("stage, candidate_id, job_id").eq("id", cjId).single();
  if (cj && !["interviewing", "offer", "placed"].includes(cj.stage)) {
    await supabase.from("candidate_jobs").update({ stage: "interviewing" }).eq("id", cjId);
  }
  revalidatePath(`/candidates/${cj?.candidate_id}`);
  revalidatePath(`/jobs/${cj?.job_id}`);
  revalidatePath("/pipeline");
  return { ok: true, message: "Saved." };
}
