import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { Nav } from "@/components/nav";
import { Clock } from "@/components/clock";
import { SearchHotkey } from "@/components/search-hotkey";
import { EmailSync } from "@/components/email-sync";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { label } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, markets } = await requireStaff();
  const name = staff.full_name ?? staff.email.split("@")[0];

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col overflow-y-auto border-r border-line bg-deep/70 px-4 py-5 backdrop-blur-md lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-3 px-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan/50 shadow-[0_0_24px_-6px_rgb(var(--glow)/0.8)]">
            <span className="readout text-[11px] text-cyan">JPR</span>
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-wide">Command Center</span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
              {markets.map((m) => m.name).join(" · ") || "No market"}
            </span>
          </span>
        </Link>

        <Nav owner={staff.role === "owner"} />

        <div className="mt-6 space-y-1 border-t border-line pt-4">
          <p className="panel-title mb-2 px-3">Quick add</p>
          {[
            ["/candidates/new", "Candidate"],
            ["/jobs/new", "Job"],
            ["/deals/new", "Deal"],
            ["/companies/new", "Company"],
          ].map(([href, text]) => (
            <Link key={href} href={href} className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-muted hover:text-cyan">
              <PlusIcon className="h-4 w-4" />
              {text}
            </Link>
          ))}
        </div>

        <div className="mt-auto rounded-lg border border-line p-3">
          <p className="truncate text-sm text-ink">{name}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{label(staff.role)}</p>
          <form action="/auth/signout" method="post" className="mt-2">
            <button className="text-xs text-muted hover:text-rose">Sign out</button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-10 border-b border-line bg-void/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="readout text-sm text-cyan lg:hidden">
            JPR
          </Link>
          <form action="/search" className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              name="q"
              type="search"
              placeholder="Search everything…  ( / )"
              className="field max-w-md py-1.5 pl-9"
              aria-label="Search"
            />
          </form>
          <div className="hidden sm:block">
            <Clock />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>
      <Nav mobile owner={staff.role === "owner"} />
      <SearchHotkey />
      <EmailSync />
    </div>
  );
}
