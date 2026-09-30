"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import type { Enums } from "@/lib/database.types";

type Decision = "save" | "send" | "hold" | "pass";

// The human SEND / EDIT / HOLD / PASS on a submission. Sending still happens in Justin's own
// mail app for now (Gmail sending arrives with the follow-up engine); this records the decision.
export async function decideSubmission(input: {
  candidateJobId: string;
  submissionId?: string;
  subject: string;
  body: string;
  contactIds: string[];
  recipients: string[];
  decision: Decision;
}) {
  const { supabase, userId } = await requireStaff();
  const now = new Date().toISOString();
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
  };

  const { error } = input.submissionId
    ? await supabase.from("submissions").update(fields).eq("id", input.submissionId)
    : await supabase.from("submissions").insert({ ...fields, candidate_job_id: input.candidateJobId, drafted_by: "human" });
  if (error) throw new Error(error.message);

  const stage: Enums<"pipeline_stage"> | null =
    input.decision === "send" ? "submitted" : input.decision === "hold" ? "on_hold" : input.decision === "pass" ? "passed" : null;
  const { data: cj } = await supabase
    .from("candidate_jobs")
    .select("candidate_id, job_id, jobs(company_id)")
    .eq("id", input.candidateJobId)
    .single();
  if (stage) {
    const { error: stageErr } = await supabase.from("candidate_jobs").update({ stage }).eq("id", input.candidateJobId);
    if (stageErr) throw new Error(stageErr.message);
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
    });
  }
  if (cj) {
    revalidatePath(`/candidates/${cj.candidate_id}`);
    revalidatePath(`/jobs/${cj.job_id}`);
  }
  revalidatePath("/");
}
