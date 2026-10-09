"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { text } from "@/lib/format";
import { parseResume, resumeText, type ParsedResume } from "@/lib/resume-parse";
import { MAX_RESUME, saveResume } from "@/lib/resume-store";

export type CaptureRead = {
  fields: ParsedResume;
  match: { id: string; full_name: string } | null;
  jobId: string | null;
  readFrom: "resume" | "page";
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);

// Step one of "Send to JPR": read the resume (or the page, when there's no file) and fill in who this is,
// which open job the page mentions, and whether they're already in the system. Nothing is saved yet.
export async function readCapture(form: FormData): Promise<CaptureRead> {
  const { supabase } = await requireStaff();
  const page = String(form.get("page") ?? "").slice(0, 30000);
  // What the bookmark saw that might be the resume, so a missed download can be tuned to Indeed's page.
  const links = String(form.get("links") ?? "");
  if (links) console.log("Send to JPR links", links.slice(0, 4000));
  const file = form.get("resume");
  let body = "";
  if (file instanceof File && file.size > 0 && file.size <= MAX_RESUME) {
    try {
      body = await resumeText(file);
    } catch (e) {
      console.error("Couldn't read captured resume", e);
    }
  }
  const fields = await parseResume(body || page);

  // Already on file: same email, same phone, or the one candidate with exactly that name.
  let match: CaptureRead["match"] = null;
  const phone = digits(fields.phone);
  const ors = [fields.email && `email.ilike.${fields.email}`, phone.length === 10 && `phone.ilike.%${phone.slice(-4)}`].filter(Boolean);
  if (ors.length) {
    const { data } = await supabase.from("candidates").select("id, full_name, email, phone").or(ors.join(",")).limit(20);
    const hit = (data ?? []).find(
      (c) => (fields.email && c.email?.toLowerCase() === fields.email.toLowerCase()) || (phone.length === 10 && digits(c.phone) === phone),
    );
    if (hit) match = { id: hit.id, full_name: hit.full_name };
  }
  if (!match && fields.full_name.trim().includes(" ")) {
    const { data } = await supabase.from("candidates").select("id, full_name").ilike("full_name", fields.full_name.trim()).limit(2);
    if (data?.length === 1) match = data[0];
  }

  // The job: an open job whose title shows up on the Indeed page (the conversation names it).
  const { data: jobs } = await supabase.from("jobs").select("id, title").eq("status", "open");
  const lower = page.toLowerCase();
  const job = (jobs ?? []).filter((j) => lower.includes(j.title.toLowerCase())).sort((a, b) => b.title.length - a.title.length)[0];
  return { fields, match, jobId: job?.id ?? null, readFrom: body ? "resume" : "page" };
}

// Step two: save it. A person already on file gets the resume and any details they were missing; anyone new
// is added as an Indeed candidate. With a job picked they land on it as Sourced, never Assigned, so nothing
// automatic starts.
export async function saveCapture(form: FormData): Promise<{ ok: boolean; message: string; id?: string }> {
  const { supabase, userId, markets } = await requireStaff();
  const name = text(form, "full_name");
  if (!name) return { ok: false, message: "Add their name first." };
  const fields = {
    full_name: name,
    phone: text(form, "phone"),
    email: text(form, "email")?.toLowerCase() ?? null,
    city: text(form, "city"),
    state: text(form, "state"),
    current_title: text(form, "current_title"),
    current_employer: text(form, "current_employer"),
  };
  let id = text(form, "match_id");
  if (id) {
    const { data: c } = await supabase.from("candidates").select("*").eq("id", id).single();
    if (!c) return { ok: false, message: "That candidate is gone." };
    const fill = Object.fromEntries(
      Object.entries(fields).filter(([k, v]) => v && !c[k as keyof typeof c]),
    ) as Partial<typeof fields>;
    if (Object.keys(fill).length) await supabase.from("candidates").update(fill).eq("id", id);
  } else {
    const { data, error } = await supabase
      .from("candidates")
      .insert({
        ...fields,
        source: "indeed",
        sourced_by: userId,
        source_market_id: markets[0]?.id ?? null,
        notes: text(form, "url") ? `Indeed profile: ${text(form, "url")}` : null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, message: error.message };
    id = data.id;
  }
  try {
    await saveResume(supabase, id, userId, form.get("resume"));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The resume didn't save.", id };
  }
  const jobId = text(form, "job_id");
  if (jobId) {
    const { data: existing } = await supabase.from("candidate_jobs").select("id").eq("candidate_id", id).eq("job_id", jobId).maybeSingle();
    if (!existing) {
      const { error } = await supabase.from("candidate_jobs").insert({ candidate_id: id, job_id: jobId, stage: "sourced", outreach_source: "indeed" });
      if (error) return { ok: false, message: `Saved, but not put on the job: ${error.message}`, id };
    }
  }
  revalidatePath(`/candidates/${id}`);
  revalidatePath("/candidates");
  revalidatePath("/pipeline");
  return { ok: true, message: `${name} is in the Command Center.`, id };
}
