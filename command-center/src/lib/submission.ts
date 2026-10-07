// Starting text for a client submission, written the way Justin writes them (from his own past
// submissions, 2026-10-01). The AI Submission Agent replaces the fill-in parts in phase 4 using
// SUBMISSION_STYLE below; until then it's built from the candidate, the job and the facts on file.

// How a JPR submission reads. The phase 4 Submission Agent gets this as its writing brief.
export const SUBMISSION_STYLE = `Write a candidate submission email to the client's hiring contact the way Justin Peace writes them.

Subject: "Candidate Submission - <Job title> - <Company> - <Candidate full name>"

Call the company by its everyday name, the way people there say it ("ACME", "ALKAB"), never the legal name with LLC, Inc or Co.

Body, plain text, short, warm and direct, in separate paragraphs with a blank line between them. No bullet
points, no headings, no marketing language, no long run-on sentences. It should read like Justin typed it quickly
to a hiring manager he knows. About 80 to 130 words before "Thanks!".
1. "Hi <first name>, I have an interested candidate for the <job title> position at <company> (resume attached)."
   Then, in the same paragraph, 2 to 4 short sentences on relevant experience. After the opening line, refer to
   the candidate by first name or by their own pronouns, never their full name. Give concrete specifics: years of
   experience, the machines, controls, software or tasks that match the job, and anything the resume leaves out or
   undersells ("His resume does not show it but..."). State the facts and let them speak; don't add a sales line
   like "that background matches the responsibilities" or "would be a great fit".
2. A short second paragraph on pay and interview times, plainly: what they want ("He is looking for $26 to $28/hr.")
   and add "but said he is negotiable" only if they said so. Don't repeat their hesitation about the job's range,
   and don't tell the client about their own job (its posted pay, shift or hours). Then the interview windows they
   gave ("He is available to interview Tuesdays and Thursdays after 1pm.").
3. Only when the candidate disclosed it and agreed it can be shared: anything the client should know up front
   (for example an old record, stated factually and briefly). Never include anything the candidate asked to keep private.
4. "Please let me know if you would like to proceed or pass on this candidate." on its own line.
5. "Thanks!" then the signature.

Example of the shape (made-up details):
Hi Mike, I have an interested candidate for the CNC Machinist position at ACME (resume attached). Dave has about 12 years running Haas and Mazak mills, mostly setups and first-article checks. His resume does not show it but he also does some basic programming in Mastercam.

He is looking to be around $27/hr but said he is negotiable. He is available to interview Monday or Wednesday after 3pm.

Please let me know if you would like to proceed or pass on this candidate.

Thanks!

Never invent experience, pay or availability. If a needed fact is missing, leave a clear [blank] for Justin to fill in.`;

export const SIGNATURE = ["--", "Justin Peace", "Founder - JPR", "www.jpeacerecruiting.com", "(814) 845-4341"].join("\n");

// What to call a company in an email: its "Name in emails" if set, otherwise the name without
// legal endings ("ACME Machine & Welding Co, LLC" -> "ACME Machine & Welding").
export function emailName(company: { name: string; short_name?: string | null } | null | undefined) {
  if (!company) return null;
  if (company.short_name?.trim()) return company.short_name.trim();
  return (
    company.name.replace(/(,?\s+(llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?))+\s*$/i, "").trim() ||
    company.name
  );
}

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
