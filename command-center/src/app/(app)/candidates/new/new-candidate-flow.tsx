"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Tables } from "@/lib/database.types";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CandidateFields } from "../candidate-fields";
import { createCandidate, readResume, type ResumeRead } from "../actions";

type Job = { id: string; title: string; company: string; auto: boolean };
const ACCEPT = ".pdf,.docx,.doc,.rtf,.txt";

// Adding a candidate the Recruiterflow way: drop a resume, the details fill themselves in, then pick
// a job and whether to automate. Nothing is saved until Save candidate.
export function NewCandidateFlow({
  jobs,
  presetJob,
  automationOn,
  marketField,
}: {
  jobs: Job[];
  presetJob?: string;
  automationOn: boolean;
  marketField: React.ReactNode;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<ResumeRead | null>(null);
  const [manual, setManual] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [assign, setAssign] = useState<"yes" | "no" | null>(presetJob ? "yes" : null);
  const [jobId, setJobId] = useState(presetJob ?? "");
  const [automate, setAutomate] = useState<"yes" | "no" | null>(null);

  async function take(f: File | undefined) {
    if (!f) return;
    setFile(f);
    if (fileInput.current) {
      const dt = new DataTransfer();
      dt.items.add(f);
      fileInput.current.files = dt.files;
    }
    setReading(true);
    const form = new FormData();
    form.set("resume", f);
    try {
      setRead(await readResume(form));
    } catch {
      setRead({ fields: null, duplicate: null, ai: false, error: "Couldn't read that file. Fill in the details below." });
    }
    setReading(false);
  }

  const showForm = Boolean(read) || manual;
  const f = read?.fields;
  const prefill = f
    ? (Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])) as unknown as Tables<"candidates">)
    : undefined;
  // Asked only when the master switch and the chosen job's switch are both on.
  const canAutomate = automationOn && Boolean(jobs.find((j) => j.id === jobId)?.auto);
  const ready = assign === "no" || (assign === "yes" && jobId && (!canAutomate || automate));

  return (
    <form action={createCandidate} className="space-y-6">
      <input ref={fileInput} type="file" name="resume" accept={ACCEPT} className="hidden" onChange={(e) => take(e.target.files?.[0])} />

      {!showForm && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            take(e.dataTransfer.files?.[0]);
          }}
          className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition ${dragging ? "border-cyan bg-cyan-soft" : "border-line hover:border-cyan/60"}`}
        >
          {reading ? (
            <div className="space-y-2">
              <p className="text-lg font-medium text-ink">Reading {file?.name}…</p>
              <p className="text-sm text-muted">Pulling out their name, contact details and work history.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-lg font-medium text-ink">Drop a resume here</p>
              <p className="text-sm text-muted">or click to choose a file. PDF or Word, up to 10MB.</p>
            </div>
          )}
        </div>
      )}
      {!showForm && !reading && (
        <button type="button" onClick={() => setManual(true)} className="btn-quiet text-sm">
          No resume? Enter details by hand
        </button>
      )}

      {showForm && (
        <>
          <div className="space-y-2">
            {file && (
              <p className="text-sm text-muted">
                Resume: <span className="text-ink">{file.name}</span>{" "}
                <button type="button" onClick={() => fileInput.current?.click()} className="link text-sm">
                  Use a different file
                </button>
              </p>
            )}
            {read?.error && <p className="text-sm text-amber">{read.error}</p>}
            {f && !read?.error && (
              <p className="text-sm text-mint">
                Filled in from the resume. Check it over; change anything that&apos;s off.
                {!read?.ai && (
                  <span className="text-faint"> (Current job and summary fill in too once the OpenAI key is in Vercel.)</span>
                )}
              </p>
            )}
            {read?.duplicate && (
              <p className="rounded-lg border border-amber/40 bg-amber/10 p-3 text-sm text-amber">
                {read.duplicate.full_name} is already in the system with this email or phone.{" "}
                <Link href={`/candidates/${read.duplicate.id}`} className="link">
                  Open their profile
                </Link>{" "}
                instead, or save this as a new candidate.
              </p>
            )}
          </div>

          <CandidateFields key={file?.name ?? "manual"} c={prefill} />
          {marketField}

          <div className="panel space-y-4 p-4">
            <div className="space-y-2">
              <p className="font-medium">Assign them to a job?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAssign("yes")} className={assign === "yes" ? "btn" : "btn-quiet"}>
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAssign("no");
                    setJobId("");
                    setAutomate(null);
                  }}
                  className={assign === "no" ? "btn" : "btn-quiet"}
                >
                  Not now
                </button>
              </div>
            </div>

            {assign === "yes" && (
              <Field label="Job" name="job_id">
                <select
                  id="job_id"
                  name="job_id"
                  required
                  value={jobId}
                  onChange={(e) => {
                    setJobId(e.target.value);
                    setAutomate(null);
                  }}
                  className="field"
                >
                  <option value="" disabled>
                    Choose an open job…
                  </option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} · {j.company}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {assign === "yes" && jobId && canAutomate && (
              <div className="space-y-2">
                <p className="font-medium">Turn on automated recruiting for this job?</p>
                <p className="text-sm text-muted">Texts and emails them on the schedule until they reply. You can switch it off any time.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAutomate("yes")} className={automate === "yes" ? "btn" : "btn-quiet"}>
                    Yes, automate
                  </button>
                  <button type="button" onClick={() => setAutomate("no")} className={automate === "no" ? "btn" : "btn-quiet"}>
                    No, I&apos;ll reach out myself
                  </button>
                </div>
                {automate === "yes" && canAutomate && <input type="hidden" name="automate" value="on" />}
              </div>
            )}
            {assign === "yes" && jobId && !canAutomate && (
              <p className="text-sm text-faint">
                {automationOn ? (
                  "Automated recruiting is off for this job, so they'll be assigned without it."
                ) : (
                  <>
                    Automated recruiting is off on{" "}
                    <Link href="/settings" className="link">
                      Phone &amp; email
                    </Link>
                    , so they&apos;ll be assigned without it.
                  </>
                )}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            {ready ? (
              <SubmitButton>Save candidate</SubmitButton>
            ) : (
              <button type="button" disabled className="btn opacity-50">
                Save candidate
              </button>
            )}
            <Link href="/candidates" className="btn-quiet">
              Cancel
            </Link>
          </div>
        </>
      )}
    </form>
  );
}
