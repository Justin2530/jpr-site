import Link from "next/link";
import { requireStaff } from "@/lib/staff";
import { CALENDAR_SCOPE, googleEvents, type CalEvent } from "@/lib/calendar";

export const metadata = { title: "Calendar · JPR" };

// Justin 2026-10-13: "a calendar in the command center that keeps track of everything and looks kind of like a
// google calendar and pushes to my google calendar". Day, week and month views; JPR's own dates come from
// calendar_events, and his Google Calendar events show alongside in gray.

const TZ = "America/New_York";
const START_HOUR = 6;
const END_HOUR = 22;
const HOUR_PX = 48;

const LOOK: Record<CalEvent["kind"], { box: string; dot: string; label: string }> = {
  interview: { box: "border-amber/60 bg-amber/15 text-amber", dot: "bg-amber", label: "Client interviews" },
  screening: { box: "border-cyan/60 bg-cyan/15 text-cyan", dot: "bg-cyan", label: "Screening calls" },
  task: { box: "border-rose/50 bg-rose/10 text-rose", dot: "bg-rose", label: "Tasks and reminders" },
  sales: { box: "border-mint/50 bg-mint/10 text-mint", dot: "bg-mint", label: "Sales" },
  google: { box: "border-line-strong bg-white/[0.06] text-ink/80", dot: "bg-muted", label: "Your Google Calendar" },
};

const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHM = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: false });

function etDate(d: Date) {
  return fmtDate.format(d);
}
function etMinutes(d: Date) {
  const [h, m] = fmtHM.format(d).split(":").map(Number);
  return (h % 24) * 60 + m;
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
function label(date: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}
function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(":00", "");
}
function hourLabel(h: number) {
  return h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`;
}

type View = "day" | "week" | "month";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const sp = await searchParams;
  const view: View = sp.view === "day" || sp.view === "month" ? sp.view : "week";
  const today = etDate(new Date());
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : today;

  // The days on screen.
  let days: string[];
  if (view === "day") days = [anchor];
  else if (view === "week") {
    const start = addDays(anchor, -weekday(anchor));
    days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  } else {
    const first = `${anchor.slice(0, 8)}01`;
    const start = addDays(first, -weekday(first));
    days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }
  const from = new Date(`${addDays(days[0], -1)}T00:00:00Z`);
  const to = new Date(`${addDays(days[days.length - 1], 2)}T00:00:00Z`);

  const { supabase, userId } = await requireStaff();
  const [{ data: ours }, { data: acct }] = await Promise.all([
    supabase.rpc("calendar_events", { p_from: from.toISOString(), p_to: to.toISOString() }),
    supabase.from("google_accounts").select("token_enc, scopes").eq("staff_id", userId).maybeSingle(),
  ]);
  const connected = Boolean(acct?.scopes?.includes(CALENDAR_SCOPE));
  let theirs: CalEvent[] = [];
  let googleError = false;
  if (connected && acct) {
    try {
      theirs = await googleEvents(acct.token_enc, from, to);
    } catch {
      googleError = true;
    }
  }
  const events = [...((ours ?? []) as unknown as CalEvent[]), ...theirs];

  // Each event placed on its Eastern date; timed ones also get their minute of the day.
  const byDay = new Map<string, { allDay: CalEvent[]; timed: (CalEvent & { at: number })[] }>();
  for (const day of days) byDay.set(day, { allDay: [], timed: [] });
  for (const e of events) {
    if (e.start) {
      const d = new Date(e.start);
      byDay.get(etDate(d))?.timed.push({ ...e, at: etMinutes(d) });
    } else if (e.date) byDay.get(e.date)?.allDay.push(e);
  }
  for (const v of byDay.values()) v.timed.sort((a, b) => a.at - b.at);

  const step = view === "day" ? 1 : view === "week" ? 7 : 0;
  const prev = view === "month" ? addDays(`${anchor.slice(0, 8)}01`, -1) : addDays(anchor, -step);
  const next = view === "month" ? addDays(`${anchor.slice(0, 8)}01`, 32) : addDays(anchor, step);
  const href = (v: View, d: string) => `/calendar?view=${v}&d=${d}`;
  const heading =
    view === "month"
      ? label(anchor, { month: "long", year: "numeric" })
      : view === "day"
        ? label(anchor, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
        : `${label(days[0], { month: "short", day: "numeric" })} – ${label(days[6], { month: "short", day: "numeric", year: "numeric" })}`;

  const nowMin = etMinutes(new Date());
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  const Chip = ({ e }: { e: CalEvent }) => (
    <Link
      href={e.href}
      target={e.kind === "google" ? "_blank" : undefined}
      title={[e.title, e.detail].filter(Boolean).join("\n")}
      className={`block truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight ${LOOK[e.kind].box} ${e.done ? "opacity-50" : ""}`}
    >
      {e.start && <span className="font-mono">{clock(e.start)} </span>}
      {e.title}
    </Link>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-2xl font-semibold tracking-tight">Calendar</h1>
        <Link href={href(view, today)} className="btn-quiet py-1">
          Today
        </Link>
        <div className="flex items-center">
          <Link href={href(view, prev)} className="btn-quiet px-2.5 py-1" aria-label="Previous">
            ‹
          </Link>
          <Link href={href(view, next)} className="btn-quiet px-2.5 py-1" aria-label="Next">
            ›
          </Link>
        </div>
        <p className="text-lg font-medium">{heading}</p>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-line p-1">
          {(["day", "week", "month"] as const).map((v) => (
            <Link
              key={v}
              href={href(v, anchor)}
              className={`rounded-md px-3 py-1 text-sm capitalize ${view === v ? "bg-cyan-soft text-cyan" : "text-muted hover:text-ink"}`}
            >
              {v}
            </Link>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {(Object.keys(LOOK) as CalEvent["kind"][])
          .filter((k) => k !== "google" || connected)
          .map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${LOOK[k].dot}`} />
              {LOOK[k].label}
            </span>
          ))}
        {!connected ? (
          <Link href="/settings" className="link">
            Connect Google Calendar: press Reconnect Gmail in Settings
          </Link>
        ) : googleError ? (
          <span className="text-rose">Couldn&apos;t load your Google Calendar right now.</span>
        ) : (
          <span className="text-faint">Synced with your Google Calendar</span>
        )}
      </div>

      {view === "month" ? (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line">
            {days.slice(0, 7).map((d) => (
              <p key={d} className="px-2 py-2 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
                {label(d, { weekday: "short" })}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const v = byDay.get(d)!;
              const list = [...v.allDay, ...v.timed];
              const other = d.slice(0, 7) !== anchor.slice(0, 7);
              return (
                <div key={d} className={`min-h-28 border-b border-r border-line p-1.5 ${other ? "bg-white/[0.01]" : ""}`}>
                  <Link
                    href={href("day", d)}
                    className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      d === today ? "bg-cyan font-semibold text-void" : other ? "text-faint" : "text-muted hover:text-ink"
                    }`}
                  >
                    {Number(d.slice(8))}
                  </Link>
                  <div className="space-y-0.5">
                    {list.slice(0, 4).map((e) => (
                      <Chip key={e.key} e={e} />
                    ))}
                    {list.length > 4 && (
                      <Link href={href("day", d)} className="block px-1 text-[11px] text-muted hover:text-cyan">
                        {list.length - 4} more
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <div style={{ minWidth: view === "week" ? 760 : undefined }}>
            {/* Day headers and all-day items */}
            <div className="grid border-b border-line" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
              <div />
              {days.map((d) => (
                <div key={d} className="border-l border-line px-1.5 py-2">
                  <Link href={href("day", d)} className="flex flex-col items-center">
                    <span className={`font-mono text-[11px] uppercase tracking-wider ${d === today ? "text-cyan" : "text-faint"}`}>
                      {label(d, { weekday: "short" })}
                    </span>
                    <span
                      className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-lg ${
                        d === today ? "bg-cyan font-semibold text-void" : "text-ink"
                      }`}
                    >
                      {Number(d.slice(8))}
                    </span>
                  </Link>
                  <div className="mt-1.5 space-y-0.5">
                    {byDay.get(d)!.allDay.map((e) => (
                      <Chip key={e.key} e={e} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Time grid */}
            <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
              <div>
                {hours.map((h) => (
                  <div key={h} style={{ height: HOUR_PX }} className="pr-2 text-right font-mono text-[10px] text-faint">
                    <span className="relative -top-1.5">{h === START_HOUR ? "" : hourLabel(h)}</span>
                  </div>
                ))}
              </div>
              {days.map((d) => (
                <div key={d} className="relative border-l border-line">
                  {hours.map((h) => (
                    <div key={h} style={{ height: HOUR_PX }} className="border-b border-line/60" />
                  ))}
                  {d === today && nowMin >= START_HOUR * 60 && nowMin < END_HOUR * 60 && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-rose"
                      style={{ top: ((nowMin - START_HOUR * 60) / 60) * HOUR_PX }}
                    >
                      <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-rose" />
                    </div>
                  )}
                  {byDay.get(d)!.timed.map((e, i, list) => {
                    const top = Math.max(0, ((Math.min(e.at, END_HOUR * 60 - 30) - START_HOUR * 60) / 60) * HOUR_PX);
                    const height = Math.max(22, ((e.minutes ?? 30) / 60) * HOUR_PX - 2);
                    // Side by side when two overlap.
                    const overlaps = list.filter((o) => Math.abs(o.at - e.at) < (o.minutes ?? 30));
                    const slot = overlaps.indexOf(e);
                    const width = 100 / Math.max(1, overlaps.length);
                    return (
                      <Link
                        key={`${e.key}-${i}`}
                        href={e.href}
                        target={e.kind === "google" ? "_blank" : undefined}
                        title={[e.title, e.detail].filter(Boolean).join("\n")}
                        className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] leading-tight transition hover:z-20 hover:brightness-125 ${LOOK[e.kind].box} ${
                          e.done ? "opacity-55" : ""
                        }`}
                        style={{ top, height, left: `calc(${slot * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
                      >
                        <span className="block truncate font-medium">{e.title}</span>
                        <span className="block truncate font-mono opacity-80">
                          {clock(e.start!)}
                          {e.detail ? ` · ${e.detail}` : ""}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
