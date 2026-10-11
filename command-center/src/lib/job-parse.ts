export type ParsedJob = {
  title: string;
  company_name: string;
  location: string;
  compensation: string;
  schedule: string;
  description: string;
  candidate_description: string;
  internal_notes: string;
  screening_questions: string[];
};

export const EMPTY_JOB: ParsedJob = {
  title: "",
  company_name: "",
  location: "",
  compensation: "",
  schedule: "",
  description: "",
  candidate_description: "",
  internal_notes: "",
  screening_questions: [],
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    company_name: { type: "string" },
    location: { type: "string" },
    compensation: { type: "string" },
    schedule: { type: "string" },
    description: { type: "string" },
    candidate_description: { type: "string" },
    internal_notes: { type: "string" },
    screening_questions: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "company_name",
    "location",
    "compensation",
    "schedule",
    "description",
    "candidate_description",
    "internal_notes",
    "screening_questions",
  ],
};

// Reads a client's job description and fills in the New job form. The company is matched to one
// already on file when the description names it. Nothing is saved here.
export async function parseJob(text: string, companies: string[]): Promise<ParsedJob | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !text) return null;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      instructions:
        "You read job descriptions for a recruiting firm and fill in its New job form. Use only what the document says; leave a field empty when it isn't there. " +
        "title: the job title only. company_name: the hiring company; if it is one of these companies already on file, use that exact name: " +
        JSON.stringify(companies.slice(0, 400)) +
        ". location: City, ST. compensation: pay as written, e.g. $22-26/hr. schedule: shift and days, e.g. 1st shift, M-F 7am-3:30pm. " +
        "description: the full original description, kept word for word; only rejoin lines a PDF broke mid-sentence. " +
        "candidate_description: the full public job posting, shown word for word on the website. Keep every section, sentence, duty, requirement, benefit and pay detail; never shorten or summarize. " +
        "Only take out what a candidate must not see: the client company's name and other client identifiers (unless the company is JPR itself), recruiting fees, and internal notes. " +
        "Format it as plain text: sections separated by a blank line, each section starting with its heading on its own short line, list items as lines starting with \u2022 and a space, and each paragraph on one line. " +
        "internal_notes: anything only the recruiter should know, such as number of openings, hiring contact, fee or start date; empty if nothing. " +
        "screening_questions: 2-4 short yes/no or quick-answer questions specific to this job's must-haves (certifications, machines, lifting, shifts, experience). " +
        "Never ask about pay, interview availability, or whether they worked at the company; those are always covered. Never ask about age, health, religion, family or marital status.",
      input: text.slice(0, 30000),
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "job", schema: SCHEMA, strict: true } },
    }),
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok) {
    console.error("Job AI failed", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const data = await res.json();
  const out = (data.output ?? [])
    .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
    .find((c: { type: string }) => c.type === "output_text")?.text;
  try {
    const job = JSON.parse(out) as ParsedJob;
    const hit = companies.find((c) => c.trim().toLowerCase() === job.company_name.trim().toLowerCase());
    return { ...job, company_name: hit ?? job.company_name.trim(), screening_questions: job.screening_questions.filter((q) => q.trim()) };
  } catch {
    return null;
  }
}
