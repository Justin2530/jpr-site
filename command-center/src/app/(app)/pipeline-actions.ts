"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { Constants, type Enums } from "@/lib/database.types";
import { beginOutreach } from "@/lib/outreach";

// Assigning a candidate to a job is the one human action that starts the workflow.
export async function assignToJob(form: FormData) {
  const { supabase, userId, staff } = await requireStaff();
  const candidateId = String(form.get("candidate_id") ?? "");
  const jobId = String(form.get("job_id") ?? "");
  if (!candidateId || !jobId) return;
  const { data, error } = await supabase
    .from("candidate_jobs")
    .insert({ candidate_id: candidateId, job_id: jobId, assigned_by: userId })
    .select("id")
    .single();
  if (error && error.code !== "23505") throw new Error(error.message);
  if (data) await beginOutreach(supabase, data.id, staff.role === "owner");
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}

export async function setStage(form: FormData) {
  const { supabase, staff } = await requireStaff();
  const stage = String(form.get("stage")) as Enums<"pipeline_stage">;
  if (!Constants.public.Enums.pipeline_stage.includes(stage)) throw new Error("Unknown stage");
  const { data, error } = await supabase
    .from("candidate_jobs")
    .update({ stage })
    .eq("id", String(form.get("id")))
    .select("id, candidate_id, job_id")
    .single();
  if (error) throw new Error(error.message);
  // Moving someone from Applied into Assigned is the same human decision as assigning them.
  if (stage === "assigned") await beginOutreach(supabase, data.id, staff.role === "owner");
  revalidatePath(`/candidates/${data.candidate_id}`);
  revalidatePath(`/jobs/${data.job_id}`);
  revalidatePath("/");
}

export async function unassign(form: FormData) {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("candidate_jobs")
    .delete()
    .eq("id", String(form.get("id")))
    .select("candidate_id, job_id")
    .single();
  if (error) throw new Error(error.message);
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

// A person turning off the automatic texts and emails for one candidate on one job.
export async function stopOutreach(form: FormData) {
  const { supabase } = await requireStaff();
  const cjId = String(form.get("id") ?? "");
  const { data: stopped } = await supabase
    .from("pursuits")
    .update({ status: "stopped", ended_at: new Date().toISOString(), end_reason: "you stopped it" })
    .eq("candidate_job_id", cjId)
    .eq("status", "active")
    .select("id");
  const ids = (stopped ?? []).map((p) => p.id);
  if (ids.length) {
    await supabase
      .from("pursuit_steps")
      .update({ status: "skipped", note: "stopped by you" })
      .in("pursuit_id", ids)
      .eq("status", "pending");
  }
  const { data } = await supabase.from("candidate_jobs").select("candidate_id").eq("id", cjId).single();
  if (data) revalidatePath(`/candidates/${data.candidate_id}`);
}
