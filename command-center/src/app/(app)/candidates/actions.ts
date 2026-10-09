"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { beginOutreach } from "@/lib/outreach";
import { text } from "@/lib/format";
import type { Enums } from "@/lib/database.types";
import { aiReady, parseResume, resumeText, type ParsedResume } from "@/lib/resume-parse";
import { MAX_RESUME, makeJprResume, saveResume } from "@/lib/resume-store";

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
  await supabase.rpc("release_candidates", { p_ids: [id] });
  const { error } = await supabase.from("candidates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
  redirect("/candidates");
}

// Several at once, from the Select view on Candidates (owner only). Same as deleting each one: their resume
// files go too, and everything linked to them goes with the record.
export async function deleteCandidates(ids: string[]): Promise<{ ok: boolean; message: string }> {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") return { ok: false, message: "Only the owner can delete candidates." };
  const list = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!list.length) return { ok: false, message: "Nobody is selected." };
  const { data: files } = await supabase.from("resumes").select("storage_path").in("candidate_id", list);
  const paths = (files ?? []).map((f) => f.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length) await supabase.storage.from("resumes").remove(paths);
  await supabase.rpc("release_candidates", { p_ids: list });
  // One at a time, so one person who can't go yet doesn't hold up the rest.
  const stuck: string[] = [];
  for (const id of list) {
    const { error } = await supabase.from("candidates").delete().eq("id", id);
    if (error) {
      const { data } = await supabase.from("candidates").select("full_name").eq("id", id).maybeSingle();
      stuck.push(`${data?.full_name ?? "Someone"}${/inbox_drafts/.test(error.message) ? " (has a reply draft waiting)" : ""}`);
    }
  }
  revalidatePath("/", "layout");
  const gone = list.length - stuck.length;
  return {
    ok: gone > 0,
    message: `Deleted ${gone} ${gone === 1 ? "candidate" : "candidates"}.${stuck.length ? ` Couldn't delete: ${stuck.join(", ")}.` : ""}`,
  };
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

// "Make JPR version" on a resume already on file.
// Removes one file from a candidate. An original resume takes its JPR version with it.
export async function deleteResume(resumeId: string, candidateId: string) {
  const { supabase } = await requireStaff();
  const { data: rows } = await supabase
    .from("resumes")
    .select("id, storage_path")
    .eq("candidate_id", candidateId)
    .or(`id.eq.${resumeId},branded_from.eq.${resumeId}`);
  if (!rows?.length) return;
  const paths = rows.map((x) => x.storage_path).filter((x): x is string => Boolean(x));
  if (paths.length) await supabase.storage.from("resumes").remove(paths);
  const { error } = await supabase.from("resumes").delete().in("id", rows.map((x) => x.id));
  if (error) throw new Error(error.message);
  revalidatePath(`/candidates/${candidateId}`);
}

// redoOf: a JPR version to replace. It's removed first, then the original is read fresh and laid out again.
export async function makeJprVersion(resumeId: string, candidateId: string, redoOf?: string) {
  const { supabase, userId } = await requireStaff();
  if (redoOf) {
    const { data: old } = await supabase.from("resumes").select("id, storage_path, branded_from").eq("id", redoOf).single();
    if (old?.branded_from !== resumeId) return { ok: false, message: "That isn't this resume's JPR version." };
    if (old.storage_path) await supabase.storage.from("resumes").remove([old.storage_path]);
    const { error } = await supabase.from("resumes").delete().eq("id", old.id);
    if (error) return { ok: false, message: error.message };
  }
  const r = await makeJprResume(supabase, userId, resumeId, Boolean(redoOf));
  revalidatePath(`/candidates/${candidateId}`);
  return r;
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
