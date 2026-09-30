import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { label, type Tone } from "@/lib/format";

export const metadata = { title: "Companies · JPR" };

const TONE: Record<string, Tone> = { client: "mint", prospect: "cyan", former_client: "muted" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase } = await requireStaff();
  let q = supabase.from("companies").select("id, name, status, city, industry, jobs(id, status), contacts(id), deals(stage)").order("name");
  if (status === "client" || status === "prospect" || status === "former_client") q = q.eq("status", status);
  const { data: companies, error } = await q;
  if (error) throw new Error(error.message);

  const tabs = [
    [undefined, "All"],
    ["client", "Clients"],
    ["prospect", "Prospects"],
    ["former_client", "Former"],
  ] as const;

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Companies"
        sub="Prospects and clients in one place. Winning a deal turns a prospect into a client."
        action={
          <Link href="/companies/new" className="btn">
            <PlusIcon className="h-4 w-4" /> New company
          </Link>
        }
      />
      <div className="mb-4 flex gap-2">
        {tabs.map(([value, text]) => (
          <Link
            key={text}
            href={value ? `/companies?status=${value}` : "/companies"}
            className={`chip px-3 py-1 ${status === value ? "border-cyan/50 text-cyan" : "border-line text-muted hover:text-ink"}`}
          >
            {text}
          </Link>
        ))}
      </div>
      {(companies ?? []).length === 0 ? (
        <Empty>No companies yet. Add your first client or prospect.</Empty>
      ) : (
        <div className="panel divide-y divide-line">
          {companies!.map((c) => {
            const open = c.jobs.filter((j) => j.status === "open").length;
            const openDeals = c.deals.filter((d) => !["won", "lost"].includes(d.stage)).length;
            return (
              <Link key={c.id} href={`/companies/${c.id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/[0.02]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-sm text-muted">{[c.industry, c.city].filter(Boolean).join(" · ") || "No details yet"}</p>
                </div>
                <span className="hidden font-mono text-xs text-muted md:inline">
                  <span className="readout text-ink">{c.contacts.length}</span> contacts
                </span>
                <span className="hidden font-mono text-xs text-muted md:inline">
                  <span className="readout text-ink">{openDeals}</span> open deals
                </span>
                <span className="hidden font-mono text-xs text-muted sm:inline">
                  <span className="readout text-ink">{open}</span> open {open === 1 ? "job" : "jobs"}
                </span>
                <Chip tone={TONE[c.status]}>{label(c.status)}</Chip>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
