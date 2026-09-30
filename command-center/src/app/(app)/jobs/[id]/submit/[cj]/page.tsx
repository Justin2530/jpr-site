import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { Chip, PageHeader, Panel } from "@/components/ui";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/format";
import { SubmitForm } from "./submit-form";

export const metadata = { title: "Submit to client · JPR" };

export default async function SubmitToClient({ params }: { params: Promise<{ id: string; cj: string }> }) {
  const { id, cj } = await params;
  const { supabase } = await requireStaff();
  const { data: row } = await supabase
    .from("candidate_jobs")
    .select(
      "id, stage, candidates(id, full_name, current_title, current_employer, city, state), jobs(id, title, company_id, hiring_contact_id, companies(name))",
    )
    .eq("id", cj)
    .eq("job_id", id)
    .maybeSingle();
  if (!row?.candidates || !row.jobs) notFound();
  const c = row.candidates;
  const job = row.jobs;

  const [{ data: contacts }, { data: notes }] = await Promise.all([
    supabase.from("contacts").select("id, full_name, title, email").eq("company_id", job.company_id).order("full_name"),
    supabase
      .from("activities")
      .select("summary")
      .eq("candidate_id", c.id)
      .in("kind", ["call", "note"])
      .order("occurred_at", { ascending: false })
      .limit(3),
  ]);
  const people = contacts ?? [];
  const preselected =
    job.hiring_contact_id && people.some((p) => p.id === job.hiring_contact_id)
      ? [job.hiring_contact_id]
      : people.slice(0, 1).map((p) => p.id);
  const first = (name: string) => name.split(" ")[0];
  const greeting = people.find((p) => p.id === preselected[0]);
  const where = [c.city, c.state].filter(Boolean).join(", ");

  const body = [
    `Hi ${greeting ? first(greeting.full_name) : "there"},`,
    "",
    `I'd like to submit ${c.full_name} for your ${job.title} opening.`,
    "",
    [
      c.current_title && `Currently: ${c.current_title}${c.current_employer ? ` at ${c.current_employer}` : ""}`,
      where && `Location: ${where}`,
    ]
      .filter(Boolean)
      .join("\n"),
    "",
    "Why they're a fit:",
    ...((notes ?? []).length ? (notes ?? []).map((n) => `- ${n.summary}`) : ["- ", "- "]),
    "",
    "Pay expectations: ",
    "Availability: ",
    "",
    "Let me know if you'd like to set up an interview.",
    "",
    "Thanks,",
    "Justin",
    "JPR",
  ].join("\n");

  return (
    <>
      <PageHeader
        kicker={
          <Link href={`/jobs/${job.id}`} className="hover:text-cyan">
            {job.companies?.name} · {job.title}
          </Link>
        }
        title={`Submit ${c.full_name}`}
        sub={<Chip tone={STAGE_TONE[row.stage]}>{STAGE_LABEL[row.stage]}</Chip>}
      />
      <Panel className="max-w-3xl">
        <SubmitForm
          cjId={row.id}
          jobId={job.id}
          contacts={people}
          preselected={preselected}
          subject={`Candidate for ${job.title}: ${c.full_name}`}
          body={body}
        />
      </Panel>
    </>
  );
}
