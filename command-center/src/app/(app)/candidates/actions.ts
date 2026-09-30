"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/staff";
import { text } from "@/lib/format";
import type { Database, Enums } from "@/lib/database.types";

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
  const { error } = await supabase.from("resumes").insert({
    candidate_id: candidateId,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: userId,
  });
  if (error) throw new Error(error.message);
}

export async function createCandidate(form: FormData) {
  const { supabase, userId, markets } = await requireStaff();
  const consent = form.get("contact_consent") === "on";
  const { data, error } = await supabase
    .from("candidates")
    .insert({
      ...candidateFields(form),
      contact_consent: consent,
      contact_consent_at: consent ? new Date().toISOString() : null,
      contact_consent_note: text(form, "contact_consent_note"),
      sourced_by: userId,
      source_market_id: text(form, "market_id") ?? markets[0]?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await saveResume(supabase, data.id, userId, form.get("resume"));

  const jobId = text(form, "job_id");
  if (jobId) {
    const { error: aErr } = await supabase.from("candidate_jobs").insert({ candidate_id: data.id, job_id: jobId, assigned_by: userId });
    if (aErr) throw new Error(aErr.message);
  }
  revalidatePath("/");
  redirect(`/candidates/${data.id}`);
}

export async function updateCandidate(form: FormData) {
  const { supabase } = await requireStaff();
  const id = String(form.get("id"));
  const consent = form.get("contact_consent") === "on";
  const { data: before } = await supabase.from("candidates").select("contact_consent, contact_consent_at").eq("id", id).single();
  const { error } = await supabase
    .from("candidates")
    .update({
      ...candidateFields(form),
      contact_consent: consent,
      contact_consent_at: consent ? (before?.contact_consent ? before.contact_consent_at : new Date().toISOString()) : null,
      contact_consent_note: text(form, "contact_consent_note"),
    })
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
