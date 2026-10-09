import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { SOURCE_LABEL, STAGE_LABEL, STAGE_TONE, timeAgo } from "@/lib/format";
import { ViewSwitcher } from "@/components/view-switcher";
import { SelectDelete } from "./select-delete";

export const metadata = { title: "Candidates · JPR" };

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string; pick?: string }> }) {
  const { q, view = "list", pick } = await searchParams;
  const { supabase, staff } = await requireStaff();
  const owner = staff.role === "owner";
  let query = supabase
    .from("candidates")
    .select("id, full_name, phone, email, current_title, current_employer, city, source, contact_consent, created_at, updated_at, candidate_jobs(stage, stage_changed_at, jobs(title))")
    .order("updated_at", { ascending: false })
    .limit(200);
  const term = q?.trim().replace(/[%,()]/g, " ");
  if (term) query = query.or(`full_name.ilike.%${term}%,current_title.ilike.%${term}%,current_employer.ilike.%${term}%,city.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
  const { data: candidates, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader
        kicker="Recruiting"
        title="Candidates"
        sub="One pool of people, each linked to any number of jobs."
        action={
          <div className="flex gap-2">
            <ViewSwitcher
              basePath="/candidates"
              current={view}
              params={{ q }}
              options={[
                { key: "list", label: "List" },
                { key: "table", label: "Table" },
                ...(owner ? [{ key: "select", label: "Select" }] : []),
              ]}
            />
            <Link href="/candidates/new" className="btn">
              <PlusIcon className="h-4 w-4" /> New candidate
            </Link>
          </div>
        }
      />
      <form className="relative mb-4 max-w-md">
        <input type="hidden" name="view" value={view} />
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input name="q" defaultValue={q} placeholder="Filter by name, title, employer, town…" className="field pl-9" aria-label="Filter candidates" />
      </form>
      {(candidates ?? []).length === 0 ? (
        <Empty>{term ? "No matches." : "No candidates yet. Add the first one."}</Empty>
      ) : view === "select" && owner ? (
        <SelectDelete
          picked={(pick ?? "").split(",")}
          rows={candidates!.map((c) => ({
            id: c.id,
            name: c.full_name,
            detail:
              c.candidate_jobs.map((cj) => `${cj.jobs?.title ?? "Job"} · ${STAGE_LABEL[cj.stage]}`).join(", ") ||
              [c.current_title, c.city].filter(Boolean).join(" · ") ||
              SOURCE_LABEL[c.source],
            added: `added ${new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}`,
          }))}
        />
      ) : view === "table" ? (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Name", "Phone", "Email", "Current role", "Town", "Source", "Latest stage", "Updated"].map((h) => (
                  <th key={h} className="panel-title px-3 py-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {candidates!.map((c) => {
                const latest = [...c.candidate_jobs].sort((a, b) => b.stage_changed_at.localeCompare(a.stage_changed_at))[0];
                return (
                  <tr key={c.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <Link href={`/candidates/${c.id}`} className="link font-medium">
                        {c.full_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{c.phone && <a href={`tel:${c.phone}`} className="link">{c.phone}</a>}</td>
                    <td className="max-w-48 truncate px-3 py-2 text-muted">{c.email}</td>
                    <td className="max-w-56 truncate px-3 py-2 text-muted">{[c.current_title, c.current_employer].filter(Boolean).join(" at ")}</td>
                    <td className="px-3 py-2 text-muted">{c.city}</td>
                    <td className="px-3 py-2 text-muted">{SOURCE_LABEL[c.source]}</td>
                    <td className="px-3 py-2">{latest ? <Chip tone={STAGE_TONE[latest.stage]}>{STAGE_LABEL[latest.stage]}</Chip> : <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2 font-mono text-xs text-faint">{timeAgo(c.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
