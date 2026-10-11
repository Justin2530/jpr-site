"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { ScreeningQuestions } from "@/components/screening-questions";
import { JobFields } from "../job-fields";
import { createJob, readJobFile, type JobRead } from "../actions";

type Company = { id: string; name: string };
type Contact = { id: string; full_name: string; company_id: string };

// Drop a client's job description and the form fills itself in, questions included. Nothing is saved until Save job.
export function NewJobFlow({ companies, contacts, companyId }: { companies: Company[]; contacts: Contact[]; companyId?: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<JobRead | null>(null);
  const [dragging, setDragging] = useState(false);
  const [round, setRound] = useState(0);

  async function take(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setReading(true);
    const form = new FormData();
    form.set("file", f);
    try {
      setRead(await readJobFile(form));
    } catch {
      setRead({ job: null, error: "Couldn't read that file. Fill in the job below." });
    }
    setReading(false);
    setRound((n) => n + 1);
  }

  const j = read?.job;
  const known = j && companies.some((c) => c.name === j.company_name);

  return (
    <div className="space-y-4">
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.docx,.rtf,.txt"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={() => !reading && fileInput.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!reading) take(e.dataTransfer.files?.[0]);
        }}
        className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${dragging ? "border-cyan bg-cyan-soft" : "border-line hover:border-cyan/60"}`}
      >
        {reading ? (
          <div className="space-y-1">
            <p className="font-medium text-ink">Reading {file?.name}…</p>
            <p className="text-sm text-muted">Pulling out the title, company, pay, schedule and screening questions.</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="font-medium text-ink">{file ? "Drop another job description" : "Drop a job description here"}</p>
            <p className="text-sm text-muted">or click to choose a file. PDF, Word or text. The form below fills itself in.</p>
          </div>
        )}
      </div>
      {read?.error && <p className="text-sm text-amber">{read.error}</p>}
      {j && !read?.error && (
        <p className="text-sm text-mint">
          Filled in from {file?.name}
          {j.company_name && (known ? `, matched to ${j.company_name}` : `. ${j.company_name} is new and will be added as a prospect`)}. Check it
          over, then Save job.
        </p>
      )}

      <form key={round} action={createJob} className="space-y-4">
        <JobFields
          companies={companies}
          contacts={contacts}
          companyId={companyId}
          companyName={j?.company_name || undefined}
          job={
            j
              ? {
                  title: j.title,
                  location: j.location || null,
                  compensation: j.compensation || null,
                  schedule: j.schedule || null,
                  description: j.description || null,
                  candidate_description: j.candidate_description || null,
                  internal_notes: j.internal_notes || null,
                }
              : undefined
          }
        />
        <ScreeningQuestions defaults={j?.screening_questions} />
        <div className="flex gap-2 pt-2">
          <SubmitButton>Save job</SubmitButton>
          <Link href="/jobs" className="btn-quiet">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
