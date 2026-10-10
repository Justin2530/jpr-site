import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Empty, PageHeader, Panel } from "@/components/ui";

export const metadata = { title: "Search · JPR" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const term = q.trim().replace(/[%,()]/g, " ");
  const { supabase } = await requireStaff();

  if (!term) {
    return (
      <>
        <PageHeader title="Search" />
        <Empty>Type in the search bar above.</Empty>
      </>
    );
  }

  const like = `%${term}%`;
  const [candidates, jobs, companies, contacts, deals] = await Promise.all([
    supabase
      .from("candidates")
      .select("id, full_name, current_title, current_employer")
      .or(`full_name.ilike.${like},current_title.ilike.${like},current_employer.ilike.${like},email.ilike.${like},phone.ilike.${like},city.ilike.${like}`)
      .limit(20),
    supabase.from("jobs").select("id, title, companies(name)").or(`title.ilike.${like},location.ilike.${like}`).limit(20),
    supabase.from("companies").select("id, name, city").or(`name.ilike.${like},city.ilike.${like},industry.ilike.${like}`).limit(20),
    supabase
      .from("contacts")
      .select("id, full_name, title, company_id, companies!contacts_company_id_fkey(name)")
      .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
      .limit(20),
    supabase.from("deals").select("id, title, companies(name)").ilike("title", like).limit(20),
  ]);

  const groups = [
    {
      title: "Candidates",
      rows: (candidates.data ?? []).map((c) => ({
        id: c.id,
        href: `/candidates/${c.id}`,
        main: c.full_name,
        sub: [c.current_title, c.current_employer].filter(Boolean).join(" at "),
      })),
    },
    { title: "Jobs", rows: (jobs.data ?? []).map((j) => ({ id: j.id, href: `/jobs/${j.id}`, main: j.title, sub: j.companies?.name ?? "" })) },
    { title: "Companies", rows: (companies.data ?? []).map((c) => ({ id: c.id, href: `/companies/${c.id}`, main: c.name, sub: c.city ?? "" })) },
    {
      title: "Contacts",
      rows: (contacts.data ?? []).map((p) => ({
        id: p.id,
        href: `/contacts/${p.id}`,
        main: p.full_name,
        sub: [p.title, p.companies?.name].filter(Boolean).join(" · "),
      })),
    },
    { title: "Deals", rows: (deals.data ?? []).map((d) => ({ id: d.id, href: `/deals/${d.id}`, main: d.title, sub: d.companies?.name ?? "" })) },
  ].filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader kicker="Search" title={`“${q}”`} />
      {groups.length === 0 ? (
        <Empty>No matches.</Empty>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {groups.map((g) => (
            <Panel key={g.title} title={g.title}>
              <ul className="-my-1 divide-y divide-line">
                {g.rows.map((r) => (
                  <li key={r.id} className="py-2">
                    <Link href={r.href} className="link font-medium">
                      {r.main}
                    </Link>
                    {r.sub && <p className="text-sm text-muted">{r.sub}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
