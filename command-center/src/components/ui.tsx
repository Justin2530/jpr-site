import Link from "next/link";
import type { Tone } from "@/lib/format";

const TONES: Record<Tone, string> = {
  cyan: "border-cyan/40 text-cyan bg-cyan-soft",
  amber: "border-amber/40 text-amber bg-amber/10",
  mint: "border-mint/40 text-mint bg-mint/10",
  rose: "border-rose/40 text-rose bg-rose/10",
  muted: "border-line text-muted bg-white/[0.02]",
};

export function Chip({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`chip ${TONES[tone]}`}>{children}</span>;
}

export function PageHeader({
  kicker,
  title,
  sub,
  action,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker && <p className="panel-title mb-1.5 text-cyan/80">{kicker}</p>}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      </div>
      {action}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="panel-title">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, href, tone = "cyan" }: { label: string; value: number | string; href?: string; tone?: Tone }) {
  const color = tone === "amber" ? "text-amber" : tone === "mint" ? "text-mint" : tone === "rose" ? "text-rose" : "text-ink";
  const body = (
    <div className="panel group relative overflow-hidden px-4 py-3.5 transition hover:border-line-strong">
      <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan/50 to-transparent opacity-60" />
      <p className="panel-title">{label}</p>
      <p className={`readout mt-1.5 text-3xl ${color}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-faint">{children}</p>;
}

export function Field({
  label,
  name,
  children,
  className = "",
}: {
  label: string;
  name?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-wider text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

export function Dot({ tone = "cyan" }: { tone?: Tone }) {
  const c = tone === "amber" ? "bg-amber" : tone === "rose" ? "bg-rose" : tone === "mint" ? "bg-mint" : tone === "muted" ? "bg-faint" : "bg-cyan";
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${c}`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
    </span>
  );
}
