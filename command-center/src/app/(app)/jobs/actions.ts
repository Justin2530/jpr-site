"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { num, text } from "@/lib/format";
import { resolveCompany } from "@/lib/company";
import type { Enums } from "@/lib/database.types";
import { resumeText } from "@/lib/resume-parse";
import { EMPTY_JOB, parseJob, type ParsedJob } from "@/lib/job-parse";

function jobFields(form: FormData) {
  return {
    title: text(form, "title")!,
    status: (text(form, "status") ?? "open") as Enums<"job_status">,
    visibility: (text(form, "visibility") ?? "private") as Enums<"job_visibility">,
    location: text(form, "location"),
    compensation: text(form, "compensation"),
    schedule: text(form, "schedule"),
    priority: num(form, "priority") ?? 2,
    description: text(form, "description"),
    candidate_description: text(form, "candidate_description"),
    internal_notes: text(form, "internal_notes"),
    hiring_contact_id: text(form, "hiring_contact_id"),
  };
}

export async function createJob(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  // Every job needs its own screening questions, or an explicit "None".
  const questions = form.getAll("question").map((q) => String(q).trim()).filter(Boolean);
  if (!questions.length && form.get("no_questions") !== "on") throw new Error("Add a screening question, or tick None.");
  const company = await resolveCompany(supabase, form, { userId, marketId: markets[0].id });
  const { data, error } = await supabase
    .from("jobs")
    .insert({ ...jobFields(form), company_id: company.id, market_id: company.market_id, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (questions.length) {
    const { error: qError } = await supabase
      .from("screening_goals")
      .insert(questions.map((prompt, i) => ({ prompt, required: true, job_id: data.id, sort: i })));
    if (qError) throw new Error(qError.message);
  }
  redirect(`/jobs/${data.id}`);
}

export async function updateJob(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  const id = String(form.get("id"));
  const company = await resolveCompany(supabase, form, { userId, marketId: markets[0].id });
  const { error } = await supabase.from("jobs").update({ ...jobFields(form), company_id: company.id }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
}

export async function setJobStatus(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const { error } = await supabase.from("jobs").update({ status: text(form, "status") as Enums<"job_status"> }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
}

export async function setJobVisibility(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const visibility = text(form, "visibility") as Enums<"job_visibility">;
  if (!["private", "public", "confidential"].includes(visibility)) throw new Error("Unknown visibility.");
  const { error } = await supabase.from("jobs").update({ visibility }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
}

export async function addGoal(form: FormData) {
  const { supabase } = await requireStaff();
  const jobId = String(form.get("job_id"));
  const prompt = text(form, "prompt");
  if (!prompt) return;
  const { count } = await supabase.from("screening_goals").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  const { error } = await supabase
    .from("screening_goals")
    .insert({ job_id: jobId, prompt, required: form.get("required") === "on", sort: count ?? 0 });
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${jobId}`);
}

export async function toggleGoal(form: FormData) {
  const { supabase } = await requireStaff();
  const { error } = await supabase
    .from("screening_goals")
    .update({ required: form.get("required") === "true" })
    .eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${form.get("job_id")}`);
}

export async function deleteGoal(form: FormData) {
  const { supabase } = await requireStaff();
  const { error } = await supabase.from("screening_goals").delete().eq("id", String(form.get("id")));
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${form.get("job_id")}`);
}

export async function moveJob(id: string, status: string) {
  const { supabase } = await requireStaff();
  if (!["open", "on_hold", "filled", "closed"].includes(status)) throw new Error("Unknown status");
  const { error } = await supabase.from("jobs").update({ status: status as Enums<"job_status"> }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/jobs");
}

export type JobRead = { job: ParsedJob | null; error?: string };

// Step one of adding a job from a file: read the client's job description and fill in the form. Nothing is saved yet.
export async function readJobFile(form: FormData): Promise<JobRead> {
  const { supabase } = await requireStaff();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { job: null, error: "No file came through." };
  if (file.size > 10 * 1024 * 1024) return { job: null, error: "That file is over 10MB." };
  let body = "";
  try {
    body = await resumeText(file);
  } catch (e) {
    console.error("Couldn't read job file", e);
  }
  if (!body) return { job: null, error: "Couldn't read text from that file (it may be a scan or an old .doc). Fill in the job below." };
  const { data: companies } = await supabase.from("companies").select("name").neq("status", "former_client");
  let job: ParsedJob | null = null;
  try {
    job = await parseJob(body, (companies ?? []).map((c) => c.name));
  } catch (e) {
    console.error("Job AI failed", e);
  }
  if (!job) return { job: { ...EMPTY_JOB, description: body }, error: "Couldn't sort the details out, so the text went into the description. Fill in the rest below." };
  return { job };
}

// Bulk actions on the Jobs list. Deleting takes the job, its pipeline and screening with it; the texts, emails
// and calls stay on each person's record.
export async function deleteJobs(ids: string[]): Promise<{ ok: boolean; message: string }> {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") return { ok: false, message: "Only the owner can delete jobs." };
  const list = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!list.length) return { ok: false, message: "No job is selected." };
  const { error: rError } = await supabase.rpc("release_jobs", { p_ids: list });
  if (rError) return { ok: false, message: `Couldn't delete: ${rError.message}` };
  const stuck: string[] = [];
  for (const id of list) {
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) {
      console.error("Job delete failed", id, error.message);
      const { data } = await supabase.from("jobs").select("title").eq("id", id).maybeSingle();
      stuck.push(data?.title ?? "a job");
    }
  }
  revalidatePath("/", "layout");
  const gone = list.length - stuck.length;
  return {
    ok: gone > 0,
    message: `Deleted ${gone} ${gone === 1 ? "job" : "jobs"}.${stuck.length ? ` Couldn't delete: ${stuck.join(", ")}.` : ""}`,
  };
}

export async function setJobsStatus(ids: string[], status: string): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireStaff();
  const list = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!list.length || !["open", "on_hold", "filled", "closed"].includes(status)) return { ok: false, message: "Nothing to change." };
  const { error } = await supabase.from("jobs").update({ status: status as Enums<"job_status"> }).in("id", list);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/jobs");
  return { ok: true, message: `Moved ${list.length} ${list.length === 1 ? "job" : "jobs"} to ${status.replace("_", " ")}.` };
}

// The job description page's own Edit (Justin 2026-10-13: "i need to be able to edit them or delete and replace them").
export async function saveDescription(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const share = form.get("v") === "share";
  const value = text(form, "text");
  const { error } = await supabase
    .from("jobs")
    .update(share ? { candidate_description: value } : { description: value })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/jobs/${id}/description`);
  redirect(`/jobs/${id}/description${share ? "?v=share" : ""}`);
}
