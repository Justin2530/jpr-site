import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { SOURCE_LABEL, STAGE_LABEL, STAGE_TONE, timeAgo } from "@/lib/format";

export const metadata = { title: "Candidates · JPR" };

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase } = await requireStaff();
  let query = supabase
    .from("candidates")
    .select("id, full_name, current_title, current_employer, city, source, updated_at, candidate_jobs(stage, stage_changed_at, jobs(title))")
    .order("updated_at", { ascending: false })
    .limit(200);
  const term = q?.trim().replace(/[%,()]/g, " ");
  if (term) query = query.or(`full_name.ilike.%${term}%,current_title.ilike.%${term}%,current_employer.ilike.%${term}%,city.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
  const { data: candidates, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader
        kicker="ATS"
        title="Candidates"
        sub="One pool of people, each linked to any number of jobs."
        action={
          <Link href="/candidates/new" className="btn">
            <PlusIcon className="h-4 w-4" /> New candidate
          </Link>
        }
      />
      <form className="relative mb-4 max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input name="q" defaultValue={q} placeholder="Filter by name, title, employer, town…" className="field pl-9" aria-label="Filter candidates" />
      </form>
      {(candidates ?? []).length === 0 ? (
        <Empty>{term ? "No matches." : "No candidates yet. Add the first one."}</Empty>
      ) : (
        <div className="panel divide-y divide-line">
          {candidates!.map((c) => {
            const latest = [...c.candidate_jobs].sort((a, b) => b.stage_changed_at.localeCompare(a.stage_changed_at))[0];
            return (
              <Link key={c.id} href={`/candidates/${c.id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/[0.02]">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-xs text-cyan">
                  {c.full_name
                    .split(/\s+/)
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.full_name}</p>
                  <p className="truncate text-sm text-muted">
                    {[c.current_title, c.current_employer && `at ${c.current_employer}`, c.city].filter(Boolean).join(" · ") || SOURCE_LABEL[c.source]}
                  </p>
                </div>
                {latest && (
                  <div className="hidden text-right sm:block">
                    <Chip tone={STAGE_TONE[latest.stage]}>{STAGE_LABEL[latest.stage]}</Chip>
                    <p className="mt-0.5 max-w-48 truncate text-xs text-faint">{latest.jobs?.title}</p>
                  </div>
                )}
                <span className="hidden w-16 text-right font-mono text-[11px] text-faint md:block">{timeAgo(c.updated_at)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
