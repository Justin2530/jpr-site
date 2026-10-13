import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { accessToken, openToken } from "@/lib/google";

// The Command Center calendar (Justin 2026-10-13): everything JPR has a date for, shown like Google Calendar and
// pushed to his own Google Calendar. calendar_events (database) is the one list both use.

export type CalEvent = {
  key: string;
  kind: "interview" | "screening" | "task" | "sales" | "google";
  title: string;
  start?: string; // timed events
  minutes?: number;
  date?: string; // all-day events, YYYY-MM-DD
  detail: string;
  href: string;
  done: boolean;
};

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const APP = "https://jpr-site-wellthree.vercel.app";
// Google's event colors: tangerine, peacock, graphite, sage.
const COLOR: Record<string, string> = { interview: "6", screening: "7", task: "8", sales: "2" };

function nextDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function googleBody(e: CalEvent) {
  const when = e.start
    ? {
        start: { dateTime: e.start, timeZone: "America/New_York" },
        end: {
          dateTime: new Date(Date.parse(e.start) + (e.minutes ?? 30) * 60_000).toISOString(),
          timeZone: "America/New_York",
        },
      }
    : { start: { date: e.date }, end: { date: nextDay(e.date!) } };
  return {
    summary: e.title,
    description: [e.detail, `Open in the Command Center: ${APP}${e.href}`].filter(Boolean).join("\n\n"),
    colorId: COLOR[e.kind],
    extendedProperties: { private: { jpr: e.key } },
    ...when,
  };
}

async function google(token: string, method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (method === "DELETE" && (res.status === 404 || res.status === 410)) return null;
  if (!res.ok) {
    const err = new Error(`Google Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : ((await res.json()) as { id: string });
}

// Each tick: create, update or remove only what changed since the last push.
export async function pushCalendar(db: SupabaseClient<Database>, secret: string) {
  const { data, error } = await db.rpc("calendar_feed", { p_secret: secret });
  if (error) throw new Error(error.message);
  const feed = data as unknown as {
    staff_id: string;
    token: string;
    events: CalEvent[];
    gone: string[];
    links: Record<string, { id: string; fp: string; removed: boolean }>;
  } | null;
  if (!feed) return 0;
  const save = (key: string, id: string, fp: string, removed = false) =>
    db.rpc("calendar_link_save", { p_secret: secret, p_staff: feed.staff_id, p_key: key, p_event: id, p_fp: fp, p_removed: removed });

  let token: string | null = null;
  const auth = async () => (token ??= await accessToken(openToken(feed.token)));
  let changed = 0;
  for (const e of feed.events) {
    const body = googleBody(e);
    const fp = JSON.stringify([body.summary, body.start, body.end, body.description]);
    const link = feed.links[e.key];
    if (link && !link.removed && link.fp === fp) continue;
    // Something already over that never made it to Google stays off; the calendar page still shows it.
    if (!link && e.done) continue;
    try {
      let id = link && !link.removed ? link.id : null;
      if (id) {
        try {
          await google(await auth(), "PATCH", `${API}/${encodeURIComponent(id)}`, body);
        } catch (err) {
          // Deleted by hand in Google: make it again.
          if ((err as { status?: number }).status !== 404 && (err as { status?: number }).status !== 410) throw err;
          id = null;
        }
      }
      if (!id) id = (await google(await auth(), "POST", API, body))!.id;
      await save(e.key, id, fp);
      changed++;
    } catch (err) {
      console.error("Calendar push failed", e.key, err);
    }
  }
  for (const key of feed.gone) {
    const link = feed.links[key];
    try {
      await google(await auth(), "DELETE", `${API}/${encodeURIComponent(link.id)}`);
      await save(key, link.id, link.fp, true);
      changed++;
    } catch (err) {
      console.error("Calendar removal failed", key, err);
    }
  }
  return changed;
}

// His own Google Calendar events for the calendar page, without the ones JPR put there (those show from JPR's data).
export async function googleEvents(sealedToken: string, from: Date, to: Date): Promise<CalEvent[]> {
  const token = await accessToken(openToken(sealedToken));
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(`${API}?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
  const json = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      status?: string;
      htmlLink?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      extendedProperties?: { private?: { jpr?: string } };
    }[];
  };
  return (json.items ?? [])
    .filter((g) => g.status !== "cancelled" && !g.extendedProperties?.private?.jpr)
    .map((g) => ({
      key: `g:${g.id}`,
      kind: "google" as const,
      title: g.summary || "(No title)",
      start: g.start?.dateTime,
      minutes:
        g.start?.dateTime && g.end?.dateTime
          ? Math.max(15, (Date.parse(g.end.dateTime) - Date.parse(g.start.dateTime)) / 60_000)
          : undefined,
      date: g.start?.dateTime ? undefined : g.start?.date,
      detail: g.location ?? "",
      href: g.htmlLink ?? "https://calendar.google.com",
      done: false,
    }));
}
