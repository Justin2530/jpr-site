"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CandidatesIcon, ClientsIcon, HomeIcon, JobsIcon, ToolsIcon } from "./icons";

const ITEMS = [
  { href: "/", label: "What needs me", Icon: HomeIcon },
  { href: "/clients", label: "Clients", Icon: ClientsIcon },
  { href: "/jobs", label: "Jobs", Icon: JobsIcon },
  { href: "/candidates", label: "Candidates", Icon: CandidatesIcon },
];
const OWNER_ITEMS = [{ href: "/tools", label: "Tools & costs", Icon: ToolsIcon }];

export function Nav({ mobile = false, owner = false }: { mobile?: boolean; owner?: boolean }) {
  const path = usePathname();
  const items = owner ? [...ITEMS, ...OWNER_ITEMS] : ITEMS;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  if (mobile) {
    return (
      <nav className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-line bg-deep/95 backdrop-blur-md lg:hidden">
        {items.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-1 py-2.5 text-[10.5px] ${active(href) ? "text-cyan" : "text-muted"}`}
          >
            <Icon />
            {label === "What needs me" ? "Home" : label === "Tools & costs" ? "Tools" : label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      {items.map(({ href, label, Icon }) => {
        const on = active(href);
        return (
          <Link
            key={href}
            href={href}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              on ? "bg-cyan-soft text-cyan" : "text-muted hover:bg-white/[0.03] hover:text-ink"
            }`}
          >
            {on && <span className="absolute -left-4 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-cyan shadow-[0_0_12px_rgb(56_217_245/0.9)]" />}
            <Icon />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
