import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { SECTIONS } from "@/components/nav";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Menu · JPR" };

export default async function MenuPage() {
  const { staff } = await requireStaff();
  const owner = staff.role === "owner";
  return (
    <>
      <PageHeader title="Menu" />
      <div className="space-y-6">
        {SECTIONS.map((s) => (
          <div key={s.title ?? "home"}>
            {s.title && <p className="panel-title mb-2">{s.title}</p>}
            <div className="grid grid-cols-2 gap-2">
              {s.items
                .filter((i) => owner || !i.ownerOnly)
                .map(({ href, label, Icon }) => (
                  <Link key={href} href={href} className="panel flex items-center gap-3 px-4 py-3 text-sm hover:border-line-strong">
                    <Icon className="h-5 w-5 text-cyan" />
                    {label}
                  </Link>
                ))}
            </div>
          </div>
        ))}
        <form action="/auth/signout" method="post">
          <button className="btn-quiet">Sign out</button>
        </form>
      </div>
    </>
  );
}
