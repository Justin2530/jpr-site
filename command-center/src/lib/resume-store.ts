import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { resumeText } from "@/lib/resume-parse";

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
