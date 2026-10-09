"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CandidatesIcon, DealsIcon, HomeIcon, MenuIcon, PipelineIcon } from "./icons";
import { SECTIONS } from "@/lib/nav-sections";

const MOBILE = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/pipeline", label: "Pipeline", Icon: PipelineIcon },
  { href: "/candidates", label: "Candidates", Icon: CandidatesIcon },
  { href: "/deals", label: "Deals", Icon: DealsIcon },
  { href: "/menu", label: "More", Icon: MenuIcon },
];

export function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function Nav({ mobile = false, owner = false }: { mobile?: boolean; owner?: boolean }) {
  const path = usePathname();

  if (mobile) {
    return (
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-deep/95 backdrop-blur-md lg:hidden">
        {MOBILE.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-1 py-2.5 text-[10.5px] ${isActive(path, href) ? "text-cyan" : "text-muted"}`}
          >
            <Icon />
            {label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-5">
      {SECTIONS.map((section) => {
        const items = section.items.filter((i) => owner || !i.ownerOnly);
        if (items.length === 0) return null;
        return (
          <div key={section.title ?? "home"}>
            {section.title && <p className="panel-title mb-1.5 px-3 text-[10px] text-faint">{section.title}</p>}
            <div className="space-y-0.5">
              {items.map(({ href, label, Icon }) => {
                const on = isActive(path, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition ${
                      on ? "bg-cyan-soft text-cyan" : "text-muted hover:bg-white/[0.03] hover:text-ink"
                    }`}
                  >
                    {on && (
                      <span className="absolute -left-4 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-cyan shadow-[0_0_12px_rgb(var(--glow)/0.9)]" />
                    )}
                    <Icon />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
