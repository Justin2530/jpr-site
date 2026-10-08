import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Attachment } from "@/lib/google";

const TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

// Indeed sends a resume link (https://l.indeed.com/...) instead of a file; the third eye saves it in the
// candidate's notes. When a submission has no resume file, try that link: if it hands back a document,
// attach it and keep it on the candidate. If Indeed wants a login (an HTML page), there's nothing to attach.
export async function indeedResume(
  supabase: SupabaseClient<Database>,
  candidateId: string,
  fullName: string,
  notes: string | null,
  userId: string,
): Promise<Attachment | null> {
  const url = notes?.match(
    /Indeed resume: (https:\/\/[a-z0-9.-]*indeed\.com\/\S+)/i,
  )?.[1];
  if (!url) return null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const type = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const ext = TYPES[type];
    if (!res.ok || !ext) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (!data.length || data.length > 10 * 1024 * 1024) return null;
    const filename = `${fullName.replace(/[^\w]+/g, "_")}_Resume.${ext}`;
    const path = `${candidateId}/${crypto.randomUUID()}-${filename}`;
    const { error } = await supabase.storage
      .from("resumes")
      .upload(path, data, { contentType: type });
    if (!error)
      await supabase.from("resumes").insert({
        candidate_id: candidateId,
        storage_path: path,
        file_name: filename,
        mime_type: type,
        size_bytes: data.length,
        uploaded_by: userId,
      });
    return { filename, mimeType: type, data };
  } catch (e) {
    console.error("Couldn't fetch the Indeed resume", e);
    return null;
  }
}
