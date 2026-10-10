import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { label, type Tone } from "@/lib/format";

export const metadata = { title: "Contacts · JPR" };

const TONE: Record<string, Tone> = { client: "mint", prospect: "cyan", former_client: "muted" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase } = await requireStaff();
  let query = supabase
    .from("contacts")
    .select("id, full_name, title, phone, email, company_id, companies!contacts_company_id_fkey(name, status)")
    .order("full_name")
    .limit(500);
  const term = q?.trim().replace(/[%,()]/g, " ");
  if (term) query = query.or(`full_name.ilike.%${term}%,title.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data: contacts, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Contacts"
        sub="Hiring managers, owners and decision makers at the companies you work with."
        action={
          <Link href="/contacts/new" className="btn">
            <PlusIcon className="h-4 w-4" /> New contact
          </Link>
        }
      />
      <form className="relative mb-4 max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input name="q" defaultValue={q} placeholder="Filter by name, title, email, phone…" className="field pl-9" aria-label="Filter contacts" />
      </form>
      {(contacts ?? []).length === 0 ? (
        <Empty>{term ? "No matches." : "No contacts yet."}</Empty>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Name", "Title", "Company", "Phone", "Email"].map((h) => (
                  <th key={h} className="panel-title px-4 py-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contacts!.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/contacts/${p.id}`} className="link font-medium">
                      {p.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{p.title}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/companies/${p.company_id}`} className="link text-muted">
                      {p.companies?.name}
                    </Link>{" "}
                    {p.companies && <Chip tone={TONE[p.companies.status]}>{label(p.companies.status)}</Chip>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{p.phone && <a href={`tel:${p.phone}`} className="link">{p.phone}</a>}</td>
                  <td className="max-w-56 truncate px-4 py-2.5 text-muted">{p.email && <a href={`mailto:${p.email}`} className="link">{p.email}</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
