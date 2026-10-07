"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import type { Enums } from "@/lib/database.types";
import { accessToken, googleReady, openToken, sendGmail, type Attachment } from "@/lib/google";

type Decision = "save" | "send" | "hold" | "pass";

export type DecideResult = { ok: boolean; message: string; viaGmail?: boolean };

// The human SEND / EDIT / HOLD / PASS on a submission. With Gmail connected, Send goes out from the
// staff member's own mailbox with the candidate's latest resume attached; otherwise the browser opens
// their mail app. Either way this records the decision and moves the candidate.
export async function decideSubmission(input: {
  candidateJobId: string;
  submissionId?: string;
  subject: string;
  body: string;
  contactIds: string[];
  recipients: string[];
  decision: Decision;
}): Promise<DecideResult> {
  const { supabase, userId } = await requireStaff();
  const now = new Date().toISOString();

  let sent: { id: string; threadId: string } | null = null;
  let attached: string | null = null;
  if (input.decision === "send") {
    const { data: account } = await supabase.from("google_accounts").select("email, token_enc").eq("staff_id", userId).maybeSingle();
    if (account && googleReady()) {
      const { data: people } = await supabase.from("contacts").select("email").in("id", input.contactIds);
      const to = (people ?? []).map((p) => p.email?.trim()).filter(Boolean) as string[];
      if (!to.length) return { ok: false, message: "None of the people you picked have an email address on file." };
      const { data: link } = await supabase.from("candidate_jobs").select("candidate_id").eq("id", input.candidateJobId).single();
      const attachments: Attachment[] = [];
      const { data: resume } = await supabase
        .from("resumes")
        .select("file_name, mime_type, storage_path")
        .eq("candidate_id", link?.candidate_id ?? "")
        .not("storage_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (resume?.storage_path) {
        const { data: file } = await supabase.storage.from("resumes").download(resume.storage_path);
        if (file) {
          attachments.push({
            filename: resume.file_name,
            mimeType: resume.mime_type || "application/octet-stream",
            data: Buffer.from(await file.arrayBuffer()),
          });
          attached = resume.file_name;
        }
      }
      try {
        sent = await sendGmail(await accessToken(openToken(account.token_enc)), {
          from: account.email,
          to: to.join(", "),
          subject: input.subject,
          body: input.body,
          attachments,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Gmail didn't accept the email.";
        return {
          ok: false,
          message: /invalid_grant|decrypt|auth/i.test(msg) ? "Gmail needs reconnecting in Settings." : msg,
        };
      }
    }
  }
  const status: Enums<"submission_status"> =
    input.decision === "send" ? "sent" : input.decision === "hold" ? "held" : input.decision === "pass" ? "passed" : "draft";
  const decided = input.decision === "save" ? {} : { decided_by: userId, decided_at: now };
  const fields = {
    subject: input.subject,
    body: input.body,
    to_contact_ids: input.contactIds,
    status,
    updated_at: now,
    ...decided,
    ...(status === "sent" ? { sent_at: now } : {}),
    ...(sent ? { email_thread_id: sent.threadId } : {}),
  };

  const { error } = input.submissionId
    ? await supabase.from("submissions").update(fields).eq("id", input.submissionId)
    : await supabase.from("submissions").insert({ ...fields, candidate_job_id: input.candidateJobId, drafted_by: "human" });
  if (error) return { ok: false, message: sent ? `Sent, but the submission didn't save: ${error.message}` : error.message };

  const stage: Enums<"pipeline_stage"> | null =
    input.decision === "send" ? "submitted" : input.decision === "hold" ? "on_hold" : input.decision === "pass" ? "passed" : null;
  const { data: cj } = await supabase
    .from("candidate_jobs")
    .select("candidate_id, job_id, jobs(company_id)")
    .eq("id", input.candidateJobId)
    .single();
  if (stage) {
    const { error: stageErr } = await supabase.from("candidate_jobs").update({ stage }).eq("id", input.candidateJobId);
    if (stageErr) return { ok: false, message: sent ? `Sent, but the stage didn't update: ${stageErr.message}` : stageErr.message };
  }
  if (cj && input.decision !== "save") {
    const summary =
      input.decision === "send"
        ? `Submitted to client${input.recipients.length ? `: ${input.recipients.join(", ")}` : ""}`
        : input.decision === "hold"
          ? "Submission put on hold"
          : "Passed on submitting";
    await supabase.from("activities").insert({
      kind: input.decision === "send" ? "email" : "note",
      summary,
      body: input.decision === "send" ? `Subject: ${input.subject}\n\n${input.body}` : null,
      direction: input.decision === "send" ? "out" : null,
      contact_id: input.decision === "send" ? (input.contactIds[0] ?? null) : null,
      candidate_id: cj.candidate_id,
      job_id: cj.job_id,
      candidate_job_id: input.candidateJobId,
      company_id: cj.jobs?.company_id ?? null,
      actor_id: userId,
      ...(sent ? { external_id: sent.id, external_thread_id: sent.threadId, external_status: "sent" } : {}),
    });
  }
  if (cj) {
    revalidatePath(`/candidates/${cj.candidate_id}`);
    revalidatePath(`/jobs/${cj.job_id}`);
  }
  revalidatePath("/");
  if (sent) {
    return {
      ok: true,
      viaGmail: true,
      message: attached
        ? `Sent from your Gmail with ${attached} attached.`
        : "Sent from your Gmail. There was no resume file on this candidate to attach.",
    };
  }
  return { ok: true, message: "Saved." };
}
