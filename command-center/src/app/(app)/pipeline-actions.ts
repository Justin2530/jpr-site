"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { Constants, type Enums } from "@/lib/database.types";
import { beginOutreach } from "@/lib/outreach";
import { OUTREACH_SOURCES, type OutreachSource } from "@/lib/format";

const outreachSource = (form: FormData) => {
  const v = String(form.get("outreach_source") ?? "");
  return OUTREACH_SOURCES.some((o) => o.value === v) ? (v as OutreachSource) : null;
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
    .insert({ candidate_id: candidateId, job_id: jobId, assigned_by: userId, outreach_source: outreachSource(form) })
    .select("id")
    .single();
  if (error && error.code !== "23505") throw new Error(error.message);
  if (data && form.get("automate") === "on") await beginOutreach(supabase, data.id, staff.role === "owner");
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}

export async function setStage(form: FormData) {
  const { supabase } = await requireStaff();
  const stage = String(form.get("stage")) as Enums<"pipeline_stage">;
  if (!Constants.public.Enums.pipeline_stage.includes(stage)) throw new Error("Unknown stage");
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
  const { data, error } = await supabase.from("candidate_jobs").delete().eq("id", id).select("candidate_id, job_id").maybeSingle();
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
    const { error } = await supabase.rpc("set_outreach", { p_candidate_job_id: cjId, p_on: false });
    if (error) throw new Error(error.message);
  }
  const { data } = await supabase.from("candidate_jobs").select("candidate_id, job_id").eq("id", cjId).single();
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
  const { error } = await supabase.rpc("screening_call_now", { p_candidate_job_id: cjId });
  if (error) throw new Error(error.message);
  const { data } = await supabase.from("candidate_jobs").select("candidate_id").eq("id", cjId).single();
  if (data) revalidatePath(`/candidates/${data.candidate_id}`);
  revalidatePath("/");
}

// The job's Automated recruiting switch: off pauses everyone on this job where they are, on picks them back up.
export async function setJobAutomation(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id") ?? "");
  const { error } = await supabase.rpc("set_job_automation", { p_job: id, p_on: form.get("on") === "true" });
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/pipeline");
  revalidatePath("/");
}
