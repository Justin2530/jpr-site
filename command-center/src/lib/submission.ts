// Starting text for a client submission, written the way Justin writes them (from his own past
// submissions, 2026-10-01). The AI Submission Agent replaces the fill-in parts in phase 4 using
// SUBMISSION_STYLE below; until then it's built from the candidate, the job and the facts on file.

// How a JPR submission reads. The phase 4 Submission Agent gets this as its writing brief.
export const SUBMISSION_STYLE = `Write a candidate submission email to the client's hiring contact the way Justin Peace writes them.

Subject: "Candidate Submission - <Job title> - <Company> - <Candidate full name>"

Body, plain text, short, warm and direct. No bullet points, no headings, no marketing language.
1. "Hi <first name>, I have an interested candidate for the <job title> position at <company> (resume attached)."
   Continue the same paragraph with 2 to 5 plain sentences on relevant experience, using he/she/they as the
   candidate's own pronouns are known (otherwise use the first name): years of experience, the machines,
   controls, software or tasks that match the job, and anything the resume leaves out or undersells
   ("His resume does not show it but...", "His resume is not up to date..."). Concrete specifics beat adjectives.
2. A paragraph on pay and logistics: what they make now and/or want ("He is looking to be around $32/hr but said
   he is negotiable", "minimum of $21/hr but is looking for $24"), shift preference, and the interview times
   they gave, written out plainly. A short list is fine only for several interview windows.
3. Only when the candidate disclosed it and agreed it can be shared: anything the client should know up front
   (for example an old record, stated factually and briefly). Never include anything the candidate asked to keep private.
4. "Please let me know if you would like to proceed or pass on this candidate."
5. "Thanks!" then the signature.

Never invent experience, pay or availability. If a needed fact is missing, leave a clear [blank] for Justin to fill in.`;

export const SIGNATURE = ["--", "Justin Peace", "Founder - JPR", "www.jpeacerecruiting.com", "(814) 845-4341"].join("\n");

type Fact = { label: string; value: string | null };

const PAY = /pay|rate|wage|salary|compensation|\$|hourly|making/i;
const SHIFT = /shift/i;
const WHEN = /avail|interview|start|notice/i;

function sentence(text: string) {
  const v = text.trim();
  return /[.!?]$/.test(v) ? v : `${v}.`;
}
const lower = (v: string) => v.charAt(0).toLowerCase() + v.slice(1);

export function draftSubmission({
  candidate,
  job,
  company,
  greetingName,
  facts,
  notes,
}: {
  candidate: { full_name: string; current_title: string | null; current_employer: string | null };
  job: { title: string };
  company?: string | null;
  greetingName?: string;
  facts: Fact[];
  notes: string[];
}) {
  const known = facts.filter((f) => f.value?.trim());
  const pay = known.filter((f) => PAY.test(f.label));
  const shift = known.filter((f) => SHIFT.test(f.label) && !pay.includes(f));
  const when = known.filter((f) => WHEN.test(f.label) && !pay.includes(f) && !shift.includes(f));
  const background = known.filter((f) => !pay.includes(f) && !shift.includes(f) && !when.includes(f));

  const current = candidate.current_title
    ? `They are currently working as ${/^[aeiou]/i.test(candidate.current_title) ? "an" : "a"} ${candidate.current_title}${candidate.current_employer ? ` at ${candidate.current_employer}` : ""}.`
    : "";
  const experience = [current, ...background.map((f) => sentence(`${f.label}: ${f.value}`)), ...notes].filter(Boolean).join(" ");
  const logistics = [
    ...pay.map((f) => sentence(f.value!)),
    ...shift.map((f) => sentence(f.value!)),
    ...when.map((f) => sentence(/^avail/i.test(f.value!.trim()) ? f.value! : `Available to interview ${lower(f.value!.trim())}`)),
  ].join(" ");

  const body = [
    `Hi ${greetingName ? greetingName.split(" ")[0] : "[name]"}, I have an interested candidate for the ${job.title} position${company ? ` at ${company}` : ""} (resume attached). ${experience || "[Experience: years, machines, controls, what matches the job.]"}`,
    "",
    logistics || "[Pay: what they make now or want.] [Shift preference.] [When they're available to interview.]",
    "",
    "Please let me know if you would like to proceed or pass on this candidate.",
    "",
    "Thanks!",
    "",
    SIGNATURE,
  ].join("\n");
  return {
    subject: ["Candidate Submission", job.title, company, candidate.full_name].filter(Boolean).join(" - "),
    body,
  };
}
