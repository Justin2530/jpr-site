"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { num, text } from "@/lib/format";
import type { Enums } from "@/lib/database.types";

// Starting information goals for every new job; edit per job afterwards.
const DEFAULT_GOALS: { prompt: string; required: boolean }[] = [
  { prompt: "Pay expectations and whether this job's pay works", required: true },
  { prompt: "Commute: where they live and whether the location works", required: true },
  { prompt: "Availability: when they could start and schedule fit", required: true },
  { prompt: "Interest in this role and why they'd move", required: true },
  { prompt: "Current situation and notice needed at current job", required: false },
];

function jobFields(form: FormData) {
  return {
    title: text(form, "title")!,
    company_id: text(form, "company_id")!,
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
  const { supabase, userId } = await requireStaff();
  const fields = jobFields(form);
  const { data: company } = await supabase.from("companies").select("market_id").eq("id", fields.company_id).single();
  if (!company) throw new Error("Pick a client for this job.");
  const { data, error } = await supabase
    .from("jobs")
    .insert({ ...fields, market_id: company.market_id, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await supabase.from("screening_goals").insert(DEFAULT_GOALS.map((g, i) => ({ ...g, job_id: data.id, sort: i })));
  redirect(`/jobs/${data.id}`);
}

export async function updateJob(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const { error } = await supabase.from("jobs").update(jobFields(form)).eq("id", id);
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
