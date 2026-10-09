"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff";
import { text } from "@/lib/format";
import { parseResume, resumeText, type ParsedResume } from "@/lib/resume-parse";
import { MAX_RESUME, saveResume } from "@/lib/resume-store";
import { accessToken, listGmail, openToken, readGmail } from "@/lib/google";

export type CaptureRead = {
  fields: ParsedResume;
  match: { id: string; full_name: string } | null;
  jobId: string | null;
  jobWhy: string | null;
  readFrom: "resume" | "page";
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);

// First and last name, ignoring case and middle names or initials ("PATRICK A. MCGINTY" is Patrick McGinty).
const nameKey = (s: string) => {
  const parts = s.toLowerCase().replace(/[^a-z' -]/g, " ").split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : "";
};

// The one candidate with the same first and last name, if exactly one.
async function sameName(supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"], name: string) {
  const key = nameKey(name);
  if (!key) return null;
  const { data } = await supabase.from("candidates").select("id, full_name").ilike("full_name", `%${key.split(" ")[1]}%`).limit(50);
  const hits = (data ?? []).filter((c) => nameKey(c.full_name) === key);
  return hits.length === 1 ? hits[0] : null;
}

// Step one of "Send to JPR": read the resume (or the page, when there's no file) and fill in who this is,
// which open job the page mentions, and whether they're already in the system. Nothing is saved yet.
export async function readCapture(form: FormData): Promise<CaptureRead> {
  const { supabase, userId } = await requireStaff();
  const page = String(form.get("page") ?? "").slice(0, 30000);
  // What the bookmark saw that might be the resume, so a missed download can be tuned to Indeed's page.
  const links = String(form.get("links") ?? "");
  if (links) console.log("Send to JPR links", links.slice(0, 4000));
  const file = form.get("resume");
  let body = "";
  if (file instanceof File && file.size > 0 && file.size <= MAX_RESUME) {
    try {
      body = await resumeText(file);
    } catch (e) {
      console.error("Couldn't read captured resume", e);
    }
  }
  const fields = await parseResume(body || page);

  // Already on file: same email, same phone, or the one candidate with exactly that name.
  let match: CaptureRead["match"] = null;
  const phone = digits(fields.phone);
  const ors = [fields.email && `email.ilike.${fields.email}`, phone.length === 10 && `phone.ilike.%${phone.slice(-4)}`].filter(Boolean);
  if (ors.length) {
    const { data } = await supabase.from("candidates").select("id, full_name, email, phone").or(ors.join(",")).limit(20);
    const hit = (data ?? []).find(
      (c) => (fields.email && c.email?.toLowerCase() === fields.email.toLowerCase()) || (phone.length === 10 && digits(c.phone) === phone),
    );
    if (hit) match = { id: hit.id, full_name: hit.full_name };
  }
  if (!match) match = await sameName(supabase, fields.full_name);

  // The job: an open job whose title shows up on the Indeed page (the conversation names it).
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, location, schedule, companies(name, short_name)")
    .eq("status", "open");
  // JPR's own test and in-house jobs are never what an Indeed outreach was about.
  const open = (jobs ?? []).filter((j) => !/\(test\)/i.test(j.title) && !/j-?\.?\s*peace/i.test(j.companies?.name ?? "")).map((j) => ({
    id: j.id,
    title: j.title,
    company: j.companies?.short_name || j.companies?.name || "",
    location: j.location,
    schedule: j.schedule,
  }));
  let onJobs: string[] = [];
  if (match) {
    const { data } = await supabase.from("candidate_jobs").select("job_id").eq("candidate_id", match.id);
    onJobs = (data ?? []).map((r) => r.job_id);
  }
  const mail = await mailAbout(supabase, userId, fields.full_name, fields.email).catch((e) => {
    console.error("Send to JPR Gmail look-up failed", e);
    return [];
  });
  const pick = await pickJob(page, fields, open, onJobs, mail).catch((e) => {
    console.error("Send to JPR job pick failed", e);
    return null;
  });
  return { fields, match, jobId: pick?.job_id || null, jobWhy: pick?.job_id ? pick.reason : null, readFrom: body ? "resume" : "page" };
}

// Step two: save it. A person already on file gets the resume and any details they were missing; anyone new
// is added as an Indeed candidate. With a job picked they land on it as Sourced, never Assigned, so nothing
// automatic starts.
export async function saveCapture(form: FormData): Promise<{ ok: boolean; message: string; id?: string }> {
  const { supabase, userId, markets } = await requireStaff();
  const name = text(form, "full_name");
  if (!name) return { ok: false, message: "Add their name first." };
  const fields = {
    full_name: name,
    phone: text(form, "phone"),
    email: text(form, "email")?.toLowerCase() ?? null,
    city: text(form, "city"),
    state: text(form, "state"),
    current_title: text(form, "current_title"),
    current_employer: text(form, "current_employer"),
  };
  let id = text(form, "match_id");
  if (!id) {
    // Same email or phone as someone on file (a second press, or a box left unticked): use that person.
    const phone = digits(fields.phone);
    const ors = [fields.email && `email.ilike.${fields.email}`, phone.length === 10 && `phone.ilike.%${phone.slice(-4)}`].filter(Boolean);
    if (ors.length) {
      const { data } = await supabase.from("candidates").select("id, email, phone").or(ors.join(",")).limit(20);
      id = (data ?? []).find((c) => (fields.email && c.email?.toLowerCase() === fields.email) || (phone.length === 10 && digits(c.phone) === phone))?.id ?? null;
    }
  }
  let updated = false;
  if (id) {
    // Already on file: the newest details win (a new phone, email, town or job), the name they're on file
    // under stays, and the resume below is added as their latest.
    const { data: c } = await supabase.from("candidates").select("*").eq("id", id).single();
    if (!c) return { ok: false, message: "That candidate is gone." };
    const fresh = Object.fromEntries(
      Object.entries(fields).filter(([k, v]) => v && (k !== "full_name" || !c.full_name) && v !== c[k as keyof typeof c]),
    ) as Partial<typeof fields>;
    // Adding someone through Send to JPR is adding them now: automation's "only people added after it was
    // turned on" rule reads created_at, so an older record (a Recruiterflow import) counts from today, and the
    // original date is kept in first_added_at.
    const readd = new Date(c.created_at) < new Date(Date.now() - 24 * 3600_000) ? { created_at: new Date().toISOString(), first_added_at: c.first_added_at ?? c.created_at } : {};
    if (Object.keys(fresh).length || Object.keys(readd).length) await supabase.from("candidates").update({ ...fresh, ...readd }).eq("id", id);
    updated = true;
  } else {
    const { data, error } = await supabase
      .from("candidates")
      .insert({
        ...fields,
        source: "indeed",
        sourced_by: userId,
        source_market_id: markets[0]?.id ?? null,
        notes: text(form, "url") ? `Indeed profile: ${text(form, "url")}` : null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, message: error.message };
    id = data.id;
  }
  try {
    await saveResume(supabase, id, userId, form.get("resume"));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The resume didn't save.", id };
  }
  const jobId = text(form, "job_id");
  if (jobId) {
    const { data: existing } = await supabase.from("candidate_jobs").select("id").eq("candidate_id", id).eq("job_id", jobId).maybeSingle();
    if (!existing) {
      const { error } = await supabase.from("candidate_jobs").insert({ candidate_id: id, job_id: jobId, stage: "sourced", outreach_source: "indeed" });
      if (error) return { ok: false, message: `Saved, but not put on the job: ${error.message}`, id };
    }
  }
  revalidatePath(`/candidates/${id}`);
  revalidatePath("/candidates");
  revalidatePath("/pipeline");
  return { ok: true, message: updated ? `${name} was already on file. Updated with the new details${form.get("resume") instanceof File && (form.get("resume") as File).size ? " and resume" : ""}.` : `${name} is in the Command Center.`, id };
}

type OpenJob = { id: string; title: string; company: string; location: string | null; schedule: string | null };

// Which open job this person was contacted about, reasoned the way Justin would: his outreach message on the
// Indeed page (town, shift, details) first, then where they live against where each job is. Indeed project names
// are his own labels and can be reused across clients, so a title match alone decides nothing.
// Justin's own emails about this person (Indeed message notifications carry his outreach and their reply,
// named after them), newest first, trimmed: the best record of which job he contacted them about.
async function mailAbout(supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"], userId: string, name: string, email: string | null) {
  if (!name.trim()) return [];
  const { data: account } = await supabase.from("google_accounts").select("token_enc").eq("staff_id", userId).maybeSingle();
  if (!account) return [];
  const token = await accessToken(openToken(account.token_enc));
  const q = [`"${name.replace(/"/g, "")}"`, email && `from:${email}`, email && `to:${email}`].filter(Boolean).join(" OR ");
  const ids = await listGmail(token, `(${q}) newer_than:120d -in:spam -in:trash`, 6);
  const msgs = await Promise.all(ids.map((m) => readGmail(token, m.id).catch(() => null)));
  return msgs
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map((m) => ({ date: m.date.toISOString().slice(0, 10), from: m.from, subject: m.subject, text: m.text.replace(/\s+\n/g, "\n").slice(0, 2500) }));
}

async function pickJob(
  page: string,
  fields: ParsedResume,
  jobs: OpenJob[],
  onJobs: string[],
  mail: { date: string; from: string; subject: string; text: string }[] = [],
) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !jobs.length) return null;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      instructions:
        "You work for JPR, a recruiting firm. Justin, the owner, reached out to this person on Indeed about one of JPR's open jobs. " +
        "From their Indeed page, work out which job in OPEN_JOBS it was. Several jobs share similar titles at different clients and towns, so reason like a recruiter: " +
        "1) Justin's own outreach is the strongest clue, whether on the Indeed page or in MY_EMAILS (his Gmail: Indeed message notifications with his outreach and their replies, or emails with them): the company, town or area it names, shift, pay, details; " +
        "2) where the person lives against where each job is (a reasonable commute); 3) the title last. " +
        "Indeed project names are Justin's own labels and can be reused for other clients, so never decide on a project name alone. " +
        "ALREADY_ON lists jobs they were put on before, possibly by mistake; it is a weak hint only. " +
        "Leave job_id empty unless you're confident; a wrong job is worse than none. reason: one short plain sentence Justin will read, e.g. \"Your message says New Kensington area, and he lives in Apollo.\"",
      input: JSON.stringify({
        person: { name: fields.full_name, city: fields.city, state: fields.state, current_title: fields.current_title },
        OPEN_JOBS: jobs,
        ALREADY_ON: onJobs,
        indeed_page: page.replace(/\n{3,}/g, "\n\n").slice(0, 15000),
        MY_EMAILS: mail,
      }),
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "job_pick",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { job_id: { type: "string" }, reason: { type: "string" } },
            required: ["job_id", "reason"],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const out = (data.output ?? [])
    .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
    .find((c: { type: string }) => c.type === "output_text")?.text;
  const r = JSON.parse(out) as { job_id: string; reason: string };
  if (!jobs.some((j) => j.id === r.job_id)) r.job_id = "";
  return r;
}
