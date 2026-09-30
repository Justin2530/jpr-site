// Starting text for a client submission. The AI Submission Agent replaces this in phase 4;
// until then it's built from the candidate, the job and whatever facts are on file.
export function draftSubmission({
  candidate,
  job,
  greetingName,
  facts,
  notes,
}: {
  candidate: {
    full_name: string;
    current_title: string | null;
    current_employer: string | null;
    city: string | null;
    state: string | null;
  };
  job: { title: string };
  greetingName?: string;
  facts: { label: string; value: string | null }[];
  notes: string[];
}) {
  const where = [candidate.city, candidate.state].filter(Boolean).join(", ");
  const known = facts.filter((f) => f.value);
  const body = [
    `Hi ${greetingName ? greetingName.split(" ")[0] : "there"},`,
    "",
    `I'd like to submit ${candidate.full_name} for your ${job.title} opening. Resume attached.`,
    "",
    [
      candidate.current_title &&
        `Currently: ${candidate.current_title}${candidate.current_employer ? ` at ${candidate.current_employer}` : ""}`,
      where && `Location: ${where}`,
    ]
      .filter(Boolean)
      .join("\n"),
    "",
    ...(known.length
      ? ["From our conversation:", ...known.map((f) => `- ${f.label}: ${f.value}`)]
      : ["Why they're a fit:", ...(notes.length ? notes.map((n) => `- ${n}`) : ["- ", "- "]), "", "Pay expectations: ", "Availability: "]),
    "",
    "Let me know if you'd like to set up an interview.",
    "",
    "Thanks,",
    "Justin",
    "JPR",
  ].join("\n");
  return { subject: `Candidate for ${job.title}: ${candidate.full_name}`, body };
}
