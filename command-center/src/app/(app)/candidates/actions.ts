"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/staff";
import { beginOutreach } from "@/lib/outreach";
import { text } from "@/lib/format";
import type { Database, Enums } from "@/lib/database.types";
import { aiReady, parseResume, resumeText, type ParsedResume } from "@/lib/resume-parse";

const MAX_RESUME = 10 * 1024 * 1024;

function candidateFields(form: FormData) {
  return {
    full_name: text(form, "full_name")!,
    phone: text(form, "phone"),
    email: text(form, "email")?.toLowerCase() ?? null,
    city: text(form, "city"),
    state: text(form, "state"),
    current_title: text(form, "current_title"),
    current_employer: text(form, "current_employer"),
    linkedin_url: text(form, "linkedin_url"),
    source: (text(form, "source") ?? "other") as Enums<"candidate_source">,
    notes: text(form, "notes"),
  };
}

async function saveResume(supabase: SupabaseClient<Database>, candidateId: string, userId: string, file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return;
  if (file.size > MAX_RESUME) throw new Error("Resume is larger than 10MB.");
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${candidateId}/${crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await supabase.storage.from("resumes").upload(path, file, { contentType: file.type || undefined });
  if (upErr) throw new Error(`Resume upload failed: ${upErr.message}`);
  let textContent: string | null = null;
  try {
    textContent = (await resumeText(file)) || null;
  } catch (e) {
    console.error("Couldn't read resume text", e);
  }
  const { error } = await supabase.from("resumes").insert({
    candidate_id: candidateId,
    text_content: textContent,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: userId,
  });
  if (error) throw new Error(error.message);
}

export type ResumeRead = {
  fields: ParsedResume | null;
  duplicate: { id: string; full_name: string } | null;
  ai: boolean;
  error?: string;
};

// Step one of adding a candidate: read the dropped resume and fill in their details. Nothing is saved yet.
export async function readResume(form: FormData): Promise<ResumeRead> {
  const { supabase } = await requireStaff();
  const file = form.get("resume");
  if (!(file instanceof File) || file.size === 0) return { fields: null, duplicate: null, ai: aiReady(), error: "No file came through." };
  if (file.size > MAX_RESUME) return { fields: null, duplicate: null, ai: aiReady(), error: "That file is over 10MB." };
  let body = "";
  try {
    body = await resumeText(file);
  } catch (e) {
    console.error("Couldn't read resume", e);
  }
  if (!body) {
    return {
      fields: null,
      duplicate: null,
      ai: aiReady(),
      error: "Couldn't read text from that file (it may be a scan or an old .doc). It will still be attached; fill in the details below.",
    };
  }
  const fields = await parseResume(body);
  let duplicate: ResumeRead["duplicate"] = null;
  const digits = fields.phone.replace(/\D/g, "").slice(-10);
  const checks = [fields.email && `email.ilike.${fields.email}`, digits.length === 10 && `phone.ilike.%${digits.slice(-4)}`].filter(Boolean);
  if (checks.length) {
    const { data } = await supabase.from("candidates").select("id, full_name, email, phone").or(checks.join(",")).limit(20);
    const hit = (data ?? []).find(
      (c) =>
        (fields.email && c.email?.toLowerCase() === fields.email) ||
        (digits.length === 10 && c.phone?.replace(/\D/g, "").slice(-10) === digits),
    );
    if (hit) duplicate = { id: hit.id, full_name: hit.full_name };
  }
  return { fields, duplicate, ai: aiReady() };
}

export async function createCandidate(form: FormData) {
  const { supabase, userId, markets, staff } = await requireStaff();
  const { data, error } = await supabase
    .from("candidates")
    .insert({
      ...candidateFields(form),
      sourced_by: userId,
      source_market_id: text(form, "market_id") ?? markets[0]?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await saveResume(supabase, data.id, userId, form.get("resume"));

  const jobId = text(form, "job_id");
  if (jobId) {
    const { data: cj, error: aErr } = await supabase
      .from("candidate_jobs")
      .insert({ candidate_id: data.id, job_id: jobId, assigned_by: userId })
      .select("id")
      .single();
    if (aErr) throw new Error(aErr.message);
    if (form.get("automate") === "on") await beginOutreach(supabase, cj.id, staff.role === "owner");
  }
  revalidatePath("/");
  redirect(`/candidates/${data.id}`);
}

// Owner only: removes the candidate everywhere (jobs, outreach, activity, files).
export async function deleteCandidate(form: FormData) {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") throw new Error("Only the owner can delete candidates.");
  const id = String(form.get("id") ?? "");
  const { data: files } = await supabase.from("resumes").select("storage_path").eq("candidate_id", id);
  const paths = (files ?? []).map((f) => f.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length) await supabase.storage.from("resumes").remove(paths);
  const { error } = await supabase.from("candidates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
  redirect("/candidates");
}

export async function updateCandidate(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const { error } = await supabase
    .from("candidates")
    .update(candidateFields(form))
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/candidates/${id}`);
}

export async function uploadResume(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const id = String(form.get("candidate_id"));
  await saveResume(supabase, id, userId, form.get("resume"));
  revalidatePath(`/candidates/${id}`);
}

export async function addNote(form: FormData) {
  const { supabase, userId } = await requireStaff();
  const id = String(form.get("candidate_id"));
  const summary = text(form, "summary");
  if (!summary) return;
  const kind = ["note", "call", "text", "email"].includes(String(form.get("kind"))) ? String(form.get("kind")) : "note";
  const { error } = await supabase.from("activities").insert({ candidate_id: id, kind, summary, actor_id: userId });
  if (error) throw new Error(error.message);
  revalidatePath(`/candidates/${id}`);
}
