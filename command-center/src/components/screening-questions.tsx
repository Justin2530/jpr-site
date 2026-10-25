"use client";

import { useState } from "react";
import { sensitiveWarning } from "@/lib/sensitive";

// One question box that warns, as Justin types, when a question touches age, health, religion,
// family or marital status.
export function QuestionInput({
  name,
  defaultValue,
  required,
  placeholder,
  className,
  label,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  label: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const warning = sensitiveWarning(value);
  return (
    <div className={className}>
      <input
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        placeholder={placeholder}
        aria-label={label}
        className="field w-full"
      />
      {warning && <p className="mt-1 text-xs text-amber">{warning}</p>}
    </div>
  );
}

// Add job: the job's own screening questions, or "None". A job can't be saved without one or the other.
export function ScreeningQuestions() {
  const [count, setCount] = useState(1);
  const [none, setNone] = useState(false);
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm text-muted">
        Screening questions for this job. Every AI call already covers pay, interview availability and whether they&apos;ve worked
        at or applied to the company, so add only what&apos;s specific to this job.
      </legend>
      {!none &&
        Array.from({ length: count }, (_, i) => (
          <QuestionInput
            key={i}
            name="question"
            required={i === 0}
            label={`Screening question ${i + 1}`}
            placeholder={i === 0 ? "e.g. Can you lift 50 lbs regularly?" : "Another question"}
          />
        ))}
      <div className="flex items-center gap-4">
        {!none && (
          <button type="button" className="btn-quiet" onClick={() => setCount((n) => n + 1)}>
            + Add another
          </button>
        )}
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" name="no_questions" checked={none} onChange={(e) => setNone(e.target.checked)} className="accent-cyan" />
          None
        </label>
      </div>
    </fieldset>
  );
}
