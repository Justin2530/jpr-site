import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { after } from "next/server";
import { resumeText } from "@/lib/resume-parse";
import { brandedText, checkWords, layoutResume, renderResume, transcribeResume } from "@/lib/resume-brand";

export const MAX_RESUME = 10 * 1024 * 1024;

// Stores a resume file on the candidate (storage + resumes row with its text for search and screening).
export async function saveResume(supabase: SupabaseClient<Database>, candidateId: string, userId: string, file: FormDataEntryValue | null) {
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
  const { data: row, error } = await supabase
    .from("resumes")
    .insert({
      candidate_id: candidateId,
      text_content: textContent,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  // A real resume (PDF or Word) gets its JPR version made right after, without holding up the save.
  if (/\.(pdf|docx?)$/i.test(file.name))
    after(() => makeJprResume(supabase, userId, row.id).then((r) => !r.ok && console.error("JPR resume:", r.message)));
}

// The JPR version of one resume: the same words laid out with JPR's logo and colors, checked word for word
// against the original and saved as its own file next to it (the original is never touched). The check
// result goes on the new file so anything lost or added is visible before it goes to a client.
export async function makeJprResume(supabase: SupabaseClient<Database>, userId: string, resumeId: string, fresh = false) {
  const { data: r } = await supabase.from("resumes").select("*").eq("id", resumeId).single();
  if (!r?.storage_path) return { ok: false, message: "That file isn't stored." };
  if (r.branded_from) return { ok: false, message: "That's already a JPR version." };
  const { data: blob } = await supabase.storage.from("resumes").download(r.storage_path);
  if (!blob) return { ok: false, message: "Couldn't open the original file." };
  const file = new File([blob], r.file_name, { type: r.mime_type ?? blob.type });
  // fresh (a redo) reads the file again instead of trusting text saved from an earlier reading.
  let text = fresh ? "" : (r.text_content ?? "");
  if (!text.trim()) {
    try {
      text = (await resumeText(file)) || "";
    } catch {
      text = "";
    }
  }
  let readFromPicture = false;
  if (text.trim().length < 80 && /pdf/i.test(file.type || r.file_name)) {
    try {
      text = await transcribeResume({ name: r.file_name, data: Buffer.from(await blob.arrayBuffer()) });
      readFromPicture = text.trim().length >= 80;
      if (readFromPicture) await supabase.from("resumes").update({ text_content: text }).eq("id", r.id);
    } catch (e) {
      return { ok: false, message: `Couldn't read the picture: ${e instanceof Error ? e.message : e}. Try Redo, or add a resume file.` };
    }
  }
  if (text.trim().length < 80) return { ok: false, message: "This file has no readable text (it may be a scanned image), so there's nothing to lay out." };
  let layout;
  try {
    layout = await layoutResume(text, { name: r.file_name, type: file.type, data: Buffer.from(await blob.arrayBuffer()) });
  } catch (e) {
    return { ok: false, message: `Couldn't lay it out: ${e instanceof Error ? e.message : e}` };
  }
  let body = brandedText(layout);
  let check = checkWords(text, body);
  // Anything dropped gets one more try with the missing words named; the better of the two is kept.
  if (check.lost.length) {
    try {
      const again = await layoutResume(text, { name: r.file_name, type: file.type, data: Buffer.from(await blob.arrayBuffer()) }, check.lost);
      const againBody = brandedText(again);
      const againCheck = checkWords(text, againBody);
      if (againCheck.lost.length + againCheck.added.length < check.lost.length + check.added.length) {
        layout = again;
        body = againBody;
        check = againCheck;
      }
    } catch {
      // keep the first try
    }
  }
  const note0 = check.ok
    ? `Checked: all ${check.total} words of the original are here, nothing added.`
    : [
        "Check this one against the original.",
        check.lost.length ? `Missing: ${check.lost.slice(0, 25).join(", ")}${check.lost.length > 25 ? "…" : ""}.` : "",
        check.added.length ? `Not in the original: ${check.added.slice(0, 25).join(", ")}${check.added.length > 25 ? "…" : ""}.` : "",
        !check.lost.length && !check.added.length ? `${check.lostCount} repeated words were dropped.` : "",
      ]
        .filter(Boolean)
        .join(" ");
  // A picture has no text to compare against, so the check is against the AI's reading of it; say so.
  const note = readFromPicture ? `Read from a picture of the resume, so give it a look. ${note0}` : note0;
  const pdf = await renderResume(layout);
  const name = `${(layout.name || "Candidate").replace(/[^\w .'-]+/g, "").trim()} - JPR.pdf`;
  const path = `${r.candidate_id}/${crypto.randomUUID()}-jpr.pdf`;
  const { error: upErr } = await supabase.storage.from("resumes").upload(path, pdf, { contentType: "application/pdf" });
  if (upErr) return { ok: false, message: `Upload failed: ${upErr.message}` };
  const { error } = await supabase.from("resumes").insert({
    candidate_id: r.candidate_id,
    text_content: body,
    storage_path: path,
    file_name: name,
    mime_type: "application/pdf",
    size_bytes: pdf.length,
    uploaded_by: userId,
    branded_from: r.id,
    brand_check: note,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: note };
}
