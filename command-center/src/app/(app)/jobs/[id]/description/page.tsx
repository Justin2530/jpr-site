import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { Empty, PageHeader } from "@/components/ui";
import { JobDescription } from "@/components/job-description";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Job description · JPR" };

// The job description on its own page, readable and printable (Print saves it as a PDF).
// ?v=share shows "What candidates can be told" instead of the full description.
export default async function JobDescriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const share = v === "share";
  const { supabase } = await requireStaff();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, location, description, candidate_description, companies(name)")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const text = (share ? job.candidate_description : job.description) ?? "";

  return (
    <>
      <PageHeader
        kicker={
          <Link href={`/jobs/${job.id}`} className="link print:hidden">
            ← {job.title}
          </Link>
        }
        title={share ? "What candidates can be told" : "Job description"}
        sub={[job.title, job.companies?.name, job.location].filter(Boolean).join(" · ")}
        action={
          <span className="flex flex-wrap gap-2 print:hidden">
            <Link href={`/jobs/${job.id}/description${share ? "" : "?v=share"}`} className="btn-quiet">
              {share ? "Full description" : "What candidates can be told"}
            </Link>
            <PrintButton>Print or save PDF</PrintButton>
          </span>
        }
      />
      {text.trim() ? (
        <article className="panel max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
          <JobDescription text={text} />
        </article>
      ) : (
        <Empty>Nothing written here yet. Add it under Edit job on the job page.</Empty>
      )}
    </>
  );
}
