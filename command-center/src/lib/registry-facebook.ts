import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { emailsIn } from "@/lib/leads";
import { isDirectoryEmail } from "@/lib/directory-sites";
import { coreWords, serp, SerpHold } from "@/lib/registry-research";

// Facebook emails for the master lead list (Justin, 2026-11-20: "i want all the emails even if its
// xyz manufacturing@yahoo.com"). Same Bright Data Facebook pages scraper the Lead Engine copied from WellThree.
// Pages the research already saw go straight to the scraper; for every other business one Google search
// (site:facebook.com, through the research's Bright Data SERP zone) looks for its page first.
// Hidden like the research: it fills lead_registry_fb, no Command Center screens, results go to his Google Sheet.

type DB = SupabaseClient<Database>;

// Bright Data "Facebook pages and profiles - collect by URL": about $1.50 per 1,000 pages.
const FB_DATASET = "gd_mf124a0511bauquyow";
const BATCH = 200; // pages per scraper job
const JOBS_OUT = 3; // scraper jobs running at once
const HOLD = [401, 402, 403, 407, 429];

const NOT_PAGE = new Set(
  ("groups events marketplace watch hashtag search login sharer share sharer.php dialog plugins stories reel reels permalink.php " +
    "story.php photo.php photo photos video.php videos l.php help policies privacy ads gaming fundraisers media notes public places " +
    "directory business home.php messages recover checkpoint settings bookmarks friends jobs offers live tr").split(" "),
);

// A Facebook page's own address (https://www.facebook.com/<page>), or null for groups, posts, events and other links.
export function fbPage(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)(facebook|fb)\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() === "pg") parts.shift();
  const first = parts[0]?.toLowerCase();
  if (!first) return null;
  if (first === "profile.php") {
    const id = u.searchParams.get("id");
    return id && /^\d+$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  // facebook.com/p/Name-123: the newer page address.
  if (first === "p") return parts[1] && /^[A-Za-z0-9.\-]+$/.test(parts[1]) ? `https://www.facebook.com/p/${parts[1]}` : null;
  // facebook.com/people/Name/123 and /pages/Name/123: unclaimed and old-style pages.
  if (first === "people" || first === "pages") {
    if (parts.length < 3 || parts[1].toLowerCase() === "category" || !/^\d+$/.test(parts[2])) return null;
    return `https://www.facebook.com/${parts[0]}/${parts[1]}/${parts[2]}`;
  }
  if (NOT_PAGE.has(first) || !/^[A-Za-z0-9.\-]{2,}$/.test(parts[0])) return null;
  return `https://www.facebook.com/${parts[0]}`;
}

// Does a result title carry most of the business's distinctive words?
function titleMatches(name: string, title: string) {
  const words = coreWords(name);
  if (!words.length) return false;
  const t = title.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9 ]/g, " ");
  return words.filter((w) => t.includes(w)).length >= Math.max(1, Math.ceil(words.length * 0.67));
}

// Google often hands results as google.com/goto links. Its breadcrumb ("https://www.facebook.com › Page › posts")
// still names the page; failing that, the goto link itself redirects to the page.
async function resultPage(o: Record<string, unknown>) {
  const link = typeof o.link === "string" ? o.link : "";
  const direct = fbPage(link);
  if (direct) return direct;
  const crumb = typeof o.display_link === "string" ? o.display_link : "";
  const m = /^https?:\/\/(?:www\.|m\.)?facebook\.com\s*›\s*([^\s›]+)/i.exec(crumb);
  if (m && m[1] !== "...") return fbPage(`https://www.facebook.com/${m[1]}`);
  if (/^https:\/\/www\.google\.com\/goto\?/.test(link) && !/^https?:\/\//.test(crumb)) {
    try {
      const res = await fetch(link, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      const to = res.headers.get("location");
      if (to) return fbPage(new URL(to, link).toString());
    } catch {}
  }
  return null;
}

// A post about the business can sit on someone else's page (the chamber's, a newspaper's), so the page's own
// address must carry one of the business's words too; a bare profile.php?id= address only counts when the result
// is the page itself, not a post.
function pageIsTheirs(name: string, page: string, o: Record<string, unknown>) {
  const slug = page.replace(/^https:\/\/www\.facebook\.com\/(?:p\/|people\/|pages\/)?/, "").replace(/profile\.php\?id=\d+/, "").replace(/\/\d+$/, "");
  const s = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s) return coreWords(name).some((w) => w.length >= 3 && s.includes(w));
  const where = `${typeof o.link === "string" ? o.link : ""} ${typeof o.display_link === "string" ? o.display_link : ""}`;
  return !/\/(posts|videos|photos|reel|events)\b|›\s*(posts|videos|photos|reel|events)\b/i.test(where);
}

// Google, not Bing: on 2026-11-20 Bing through Bright Data answered 502 or with unrelated pages (a "Jett's on the Blvd"
// search came back about a video game), while Google listed the business's page first.
export async function findPage(key: string, row: { name: string; city: string | null; county: string | null }, engine: "google" | "bing" = "google") {
  return (await searchPage(key, row, engine)).page;
}

async function searchPage(key: string, row: { name: string; city: string | null; county: string | null }, engine: "google" | "bing") {
  const town = row.city ? `${row.city} PA` : `${row.county} County PA`;
  const name = row.name.replace(/,?\s+(llc|inc\.?|incorporated|corp\.?|co\.?|ltd\.?)$/i, "");
  const j = await serp(key, `site:facebook.com ${name} ${town}`, false, engine);
  const organic = (Array.isArray(j.organic) ? (j.organic as Record<string, unknown>[]) : []).slice(0, 6);
  let page: string | null = null;
  for (const o of organic) {
    if (typeof o.title !== "string" || !titleMatches(row.name, o.title)) continue;
    const p = await resultPage(o);
    if (p && pageIsTheirs(row.name, p, o)) { page = p; break; }
  }
  return { page, organic };
}

// For checking the search by hand: the page it picks and the results it read (one search).
export async function findPageDebug(row: { name: string; city: string | null; county: string | null }, engine: "google" | "bing") {
  const key = process.env.BRIGHTDATA_API_KEY?.trim() ?? "";
  const { page, organic } = await searchPage(key, row, engine);
  return {
    page,
    results: organic.map((o) => ({ title: o.title, link: typeof o.link === "string" ? o.link.slice(0, 120) : o.link, display: o.display_link, match: typeof o.title === "string" && titleMatches(row.name, o.title) })),
  };
}

type FbRecord = Record<string, unknown> & { url?: string; input?: { url?: string } };

const contactInfo = (r: FbRecord) =>
  ((r.contact_and_basic_info as Record<string, unknown> | undefined)?.contact_info ?? {}) as Record<string, unknown>;

// The page's listed email(s): the scraper's emails fields, plus any address written in its intro.
function recordEmails(r: FbRecord) {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(add);
  };
  for (const [k, v] of Object.entries(r)) if (/email|^(about|intro|summary_text|description)$/i.test(k)) add(v);
  for (const [k, v] of Object.entries(contactInfo(r))) if (/email/i.test(k)) add(v);
  return emailsIn(parts.join(" ")).filter((e) => !isDirectoryEmail(e));
}

const STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR RI SC SD TN TX UT VT VA WA WV WI WY DC";
const STATE_RE = new RegExp(`(^|,)\\s*(${STATES.split(" ").join("|")})\\b(\\s+\\d{5})?\\s*(,|$)`);

// A search can land on a same-name business elsewhere: a page whose address names another state isn't this one.
function outOfState(r: FbRecord) {
  const texts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") texts.push(v);
    else if (v && typeof v === "object" && typeof (v as { formatted?: unknown }).formatted === "string") texts.push((v as { formatted: string }).formatted);
  };
  add(r.address);
  add(contactInfo(r).address);
  if (!texts.length) return false;
  const all = texts.join(" | ");
  if (/\bPA\b|pennsylvania/i.test(all)) return false;
  return STATE_RE.test(all) || /\b(canada|united kingdom|australia|germany|india|philippines|mexico)\b/i.test(all);
}

// What's kept of a page: its small fields (name, category, phones, websites, address, emails, followers), not posts.
function trimRecord(r: FbRecord) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    const s = JSON.stringify(v);
    if (s !== undefined && s.length <= 1500) out[k] = v;
  }
  return out;
}

async function trigger(key: string, urls: string[]) {
  const send = (body: unknown) =>
    fetch(`https://api.brightdata.com/datasets/v3/trigger?dataset_id=${FB_DATASET}&include_errors=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  const inputs = urls.map((url) => ({ url }));
  // The trigger docs show a bare list; the scraper's own page shows {"input": [...]}. Try the second if the first is refused.
  let res = await send(inputs);
  if (res.status === 400) res = await send({ input: inputs });
  return res;
}

export async function runRegistryFacebook(db: DB, secret: string, opts: { pages?: number; searches?: number; seconds?: number } = {}) {
  const started = Date.now();
  const report = { jobs_back: 0, pages_saved: 0, with_email: 0, pages_sent: 0, searched: 0, found: 0, held: false, paused: null as string | null, errors: [] as string[] };
  const note = (e: unknown) => {
    if (report.errors.length < 5) report.errors.push(e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e));
  };
  const key = process.env.BRIGHTDATA_API_KEY?.trim();
  if (!key) return { ...report, errors: ["no Bright Data key"] };
  const auth = { Authorization: `Bearer ${key}` };
  const pause = async (reason: string) => {
    report.held = true;
    if (!report.paused) {
      report.paused = reason;
      await db.rpc("lead_registry_fb_pause", { p_secret: secret, p_reason: reason });
    }
  };

  // 1. Read the scraper jobs that finished.
  const { data: snaps, error: snapErr } = await db.rpc("lead_registry_fb_snapshots", { p_secret: secret });
  if (snapErr) throw new Error(snapErr.message);
  let running = 0;
  for (const s of snaps ?? []) {
    try {
      const prog = await fetch(`https://api.brightdata.com/datasets/v3/progress/${encodeURIComponent(s.snapshot_id)}`, { headers: auth, signal: AbortSignal.timeout(15000) });
      const p = prog.ok ? ((await prog.json()) as { status?: string }) : { status: prog.status === 404 ? "failed" : "unknown" };
      const old = Date.now() - new Date(s.sent_at).getTime() > 3 * 3600_000;
      if (p.status === "ready") {
        const res = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(s.snapshot_id)}?format=json`, { headers: auth, signal: AbortSignal.timeout(60000) });
        if (!res.ok) {
          running++;
          note(`snapshot ${res.status}`);
          continue;
        }
        const rows = (await res.json()) as FbRecord[];
        let billed = 0;
        for (const r of Array.isArray(rows) ? rows : []) {
          const url = r.input?.url ?? r.url;
          if (typeof url !== "string") continue;
          const err = typeof r.error === "string" ? r.error : typeof r.error_code === "string" ? r.error_code : null;
          if (!err) billed++;
          const wrong = !err && outOfState(r);
          const emails = err || wrong ? [] : recordEmails(r);
          const { data: n, error } = await db.rpc("lead_registry_fb_save", {
            p_secret: secret, p_snapshot: s.snapshot_id, p_url: url, p_emails: emails, p_page: trimRecord(r) as Json,
            p_error: err ? err.slice(0, 200) : wrong ? "page is for a business in another state" : null,
          });
          if (error) note(`save: ${error.message}`);
          else {
            report.pages_saved += n ?? 0;
            if (emails.length) report.with_email += n ?? 0;
          }
        }
        await db.rpc("lead_registry_fb_close", { p_secret: secret, p_snapshot: s.snapshot_id, p_pages: billed, p_failed: false });
        report.jobs_back++;
      } else if (p.status === "failed" || p.status === "canceled" || old) {
        await db.rpc("lead_registry_fb_close", { p_secret: secret, p_snapshot: s.snapshot_id, p_pages: 0, p_failed: true });
      } else running++;
    } catch (e) {
      running++;
      note(e);
    }
  }

  // 2. Send the next pages to the scraper.
  for (let i = running; i < JOBS_OUT && !report.held && opts.pages !== 0; i++) {
    const { data: batch, error } = await db.rpc("lead_registry_fb_claim_pages", { p_secret: secret, p_limit: opts.pages ?? BATCH });
    if (error) throw new Error(error.message);
    if (!batch?.length) break;
    const items = batch.map((b) => ({ filing: b.filing, url: b.fb_url ? fbPage(b.fb_url) : null }));
    const urls = [...new Set(items.map((x) => x.url).filter((u): u is string => !!u))];
    let snapshot: string | null = null;
    let hold = false;
    try {
      if (urls.length) {
        const res = await trigger(key, urls);
        const text = await res.text();
        if (res.ok) snapshot = (JSON.parse(text) as { snapshot_id?: string }).snapshot_id ?? null;
        else {
          note(`trigger ${res.status}: ${text.slice(0, 200)}`);
          hold = HOLD.includes(res.status);
          if (res.status === 402 || /insufficient|balance|funds|payment/i.test(text)) await pause("Bright Data credit ran out");
          else if (hold) report.held = true;
        }
      }
    } catch (e) {
      note(e);
    } finally {
      await db.rpc("lead_registry_fb_sent", { p_secret: secret, p_items: items as unknown as Json, p_snapshot: snapshot, p_hold: hold });
    }
    if (snapshot) report.pages_sent += urls.length;
    if (opts.pages || !snapshot) break; // a test sends one small job; a refused job waits for the next tick
  }

  // 3. Look for the Facebook page of businesses without one, until the time's up.
  let left = opts.searches ?? Number.POSITIVE_INFINITY;
  const until = started + (opts.seconds ?? 100) * 1000;
  const worker = async () => {
    while (left > 0 && Date.now() < until && !report.held) {
      left--;
      const { data: rows, error } = await db.rpc("lead_registry_fb_claim_search", { p_secret: secret, p_limit: 1 });
      if (error) throw new Error(error.message);
      const row = rows?.[0];
      if (!row) return;
      try {
        const page = await findPage(key, row);
        const r = await db.rpc("lead_registry_fb_found", { p_secret: secret, p_filing: row.filing, p_url: page });
        if (r.error) note(`found: ${r.error.message}`);
        report.searched++;
        if (page) report.found++;
      } catch (e) {
        if (e instanceof SerpHold && HOLD.includes(e.status)) {
          await db.rpc("lead_registry_fb_release", { p_secret: secret, p_filing: row.filing });
          if (e.pause) await pause(e.pause);
          else report.held = true;
        } else if (e instanceof Error && /auto-throttled/i.test(e.message)) {
          await db.rpc("lead_registry_fb_release", { p_secret: secret, p_filing: row.filing });
        }
        note(e);
      }
    }
  };
  if (left > 0) await Promise.all(Array.from({ length: Math.min(8, left) }, worker));
  return report;
}

// The first records of a finished scraper job, trimmed, for checking which fields the scraper fills.
export async function fbSample(snapshot: string, n = 2) {
  const key = process.env.BRIGHTDATA_API_KEY?.trim();
  const res = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(snapshot)}?format=json`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return { status: res.status, text: (await res.text()).slice(0, 300) };
  const rows = (await res.json()) as FbRecord[];
  return { count: Array.isArray(rows) ? rows.length : 0, rows: (Array.isArray(rows) ? rows : []).slice(0, n).map((r) => ({ ...trimRecord(r), _emails: recordEmails(r), _out_of_state: outOfState(r) })) };
}
