import Link from "next/link";
import { ChevronIcon } from "./icons";

export type ViewOption = { key: string; label: string };

// Dropdown that switches a page between views (board, list, ...) via the ?view= query param.
export function ViewSwitcher({
  options,
  current,
  basePath,
  params = {},
}: {
  options: ViewOption[];
  current: string;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const active = options.find((o) => o.key === current) ?? options[0];
  const href = (view: string) => {
    const q = new URLSearchParams();
    Object.entries({ ...params, view }).forEach(([k, v]) => v && q.set(k, v));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <details className="relative">
      <summary className="btn-quiet cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">View</span>
        <span className="text-ink">{active.label}</span>
        <ChevronIcon className="h-3.5 w-3.5" />
      </summary>
      <div className="panel absolute right-0 z-30 mt-1 min-w-40 bg-panel-solid p-1">
        {options.map((o) => (
          <Link
            key={o.key}
            href={href(o.key)}
            className={`block rounded-md px-3 py-1.5 text-sm ${o.key === active.key ? "bg-cyan-soft text-cyan" : "text-muted hover:bg-white/[0.04] hover:text-ink"}`}
          >
            {o.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

// Row of filter chips that keep the current view.
export function FilterTabs({
  tabs,
  current,
  basePath,
  paramName,
  params = {},
}: {
  tabs: readonly (readonly [string | undefined, string])[];
  current: string | undefined;
  basePath: string;
  paramName: string;
  params?: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map(([value, text]) => {
        const q = new URLSearchParams();
        Object.entries({ ...params, [paramName]: value }).forEach(([k, v]) => v && q.set(k, v));
        const qs = q.toString();
        return (
          <Link
            key={text}
            href={qs ? `${basePath}?${qs}` : basePath}
            className={`chip px-3 py-1 ${current === value ? "border-cyan/50 text-cyan" : "border-line text-muted hover:text-ink"}`}
          >
            {text}
          </Link>
        );
      })}
    </div>
  );
}
