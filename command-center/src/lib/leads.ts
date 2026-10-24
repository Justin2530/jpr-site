import { resolveMx } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normName } from "@/lib/leads-shared";

// The Lead Engine's background work (Sales > Lead Engine). Each tick:
// 1. runs queued Google Maps searches through Serper (one county x keyword x page per credit), and
// 2. reads each new business's website for emails (plus a free mail-server check) and, in PA, looks the
//    business up in the state's free business registry for an owner name.
// Everything goes through the secret-checked lead functions in the database; nothing here sends anything.

type DB = SupabaseClient<Database>;
export * from "@/lib/leads-shared";

// Hosts Google sometimes lists as a business's "website" that aren't the business's own site.
const NOT_OWN_SITE = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|yelp\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|linktr\.ee|google\.com|goo\.gl|g\.page|nextdoor\.com|bbb\.org|yellowpages\.com|mapquest\.com)$/i;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Google Maps search (Serper)

export type Place = {
  key: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  website: string | null;
  facebook: string | null;
  rating: number | null;
  reviews: number | null;
  lat: number | null;
  lng: number | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

// "123 Main St, Punxsutawney, PA 15767" -> city, state, zip
export function splitAddress(address: string | null) {
  const m = (address ?? "").match(/,\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*(?:,\s*(?:USA|United States))?\s*$/);
  return m ? { city: m[1].trim(), state: m[2], zip: m[3] } : { city: null, state: null, zip: null };
}

export function parsePlace(raw: Record<string, unknown>): Place | null {
  const name = str(raw.title) ?? str(raw.name);
  if (!name) return null;
  const address = str(raw.address);
  const id = str(raw.cid) ?? str(raw.placeId) ?? str(raw.fid) ?? (typeof raw.cid === "number" ? String(raw.cid) : null);
  const key = id ? `g:${id}` : `n:${normName(name)}|${(address ?? "").toLowerCase().replace(/\s+/g, " ")}`;
  let website = str(raw.website);
  let facebook: string | null = null;
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  const host = website ? hostOf(website) : null;
  if (website && (!host || NOT_OWN_SITE.test(host))) {
    if (host && /facebook\.com$|fb\.com$/.test(host)) facebook = website;
    website = null;
  }
  const parts = splitAddress(address);
  const rawCategory = str(raw.category) ?? (Array.isArray(raw.types) ? str(raw.types[0]) : null) ?? str(raw.type);
  const reviews = num(raw.ratingCount) ?? num(raw.reviews) ?? num(raw.reviewsCount);
  return {
    key,
    name,
    category: rawCategory,
    address,
    ...parts,
    phone: str(raw.phoneNumber) ?? str(raw.phone),
    website,
    facebook,
    rating: num(raw.rating),
    reviews: reviews === null ? null : Math.round(reviews),
    lat: num(raw.latitude),
    lng: num(raw.longitude),
  };
}

// The text Google gets: "machine shop in Jefferson County, PA".
export const searchQuery = (keyword: string, county: string, state: string) => `${keyword} in ${county}, ${state}`;

class Hold extends Error {}

async function serperPlaces(key: string, q: string, page: number) {
  const res = await fetch("https://google.serper.dev/places", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, gl: "us", hl: "en", ...(page > 1 ? { page } : {}) }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    const msg = `Serper ${res.status}: ${text.slice(0, 200)}`;
    // A bad key, no credits left or too many calls: every search would fail the same way, so stop and say so.
    if ([401, 402, 403, 429].includes(res.status) || /credit|api key|unauthori/i.test(text)) throw new Hold(msg);
    throw new Error(msg);
  }
  const body = JSON.parse(text) as { places?: Record<string, unknown>[] };
  const raw = Array.isArray(body.places) ? body.places : [];
  return { places: raw.map(parsePlace).filter((p): p is Place => p !== null), rawCount: raw.length };
}

// ---------------------------------------------------------------- Website emails

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/gi;
const JUNK_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|godaddy\.com|squarespace\.com|wix\.com|domain\.com|yourdomain\.com|email\.com|website\.com|mysite\.com|company\.com|test\.com|sentry\.wixpress\.com|wordpress\.(com|org)|schema\.org|w3\.org|jquery\.com|googleapis\.com)$/i;
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|user|username|name|email|yourname|your\.?name|john\.?doe|jane\.?doe|first\.?last|example|test|filler)$/i;
const FILE_TLD = /\.(png|jpe?g|gif|svg|webp|avif|css|js|ico|bmp|tiff?|mp4|pdf)$/i;
export const FREE_MAIL = /^(gmail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|verizon|att|sbcglobal|windstream|atlanticbb|frontier|frontiernet|zoominfo|protonmail|proton|mail|gmx|earthlink|cox|charter|spectrum|centurylink|bellsouth|juno|netzero|embarqmail|ptd|penn)\.(com|net|me)$/i;

function decodeEntities(html: string) {
  return html
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&commat;|&#64;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&");
}

// Cloudflare hides emails as data-cfemail="<hex>"; the first byte is the key.
function cloudflareEmails(html: string) {
  const out: string[] = [];
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]{4,})"/gi)) {
    const hex = m[1];
    const k = parseInt(hex.slice(0, 2), 16);
    let s = "";
    for (let i = 2; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
    out.push(s);
  }
  return out;
}

export function emailsIn(html: string) {
  const text = decodeEntities(html).replace(/\s*(\[at\]|\(at\))\s*/gi, "@").replace(/\s*(\[dot\]|\(dot\))\s*/gi, ".");
  const found = new Set<string>();
  const hidden = cloudflareEmails(html).filter((e) => (e.match(EMAIL) ?? [])[0] === e);
  for (const e of [...(text.match(EMAIL) ?? []), ...hidden]) {
    const email = e.toLowerCase().replace(/^mailto:/, "").replace(/^(?:u00[0-9a-f]{2}|%20|%3c|%3e)/i, "").replace(/\.+$/, "");
    const [local, domain] = email.split("@");
    if (!local || !domain || email.length > 80) continue;
    if (FILE_TLD.test(email) || /@\d+x\./.test(email) || JUNK_EMAIL_DOMAIN.test(domain) || JUNK_LOCAL.test(local)) continue;
    if (/^[0-9a-f]{16,}$/.test(local)) continue; // tracking ids
    found.add(email);
  }
  return [...found];
}

// Links on the page worth reading for an email: contact, about, team, staff, same site only.
function contactLinks(html: string, base: URL) {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1];
    const label = m[2].replace(/<[^>]+>/g, " ");
    if (!/contact|about|team|staff|leadership|our-people|location/i.test(href + " " + label)) continue;
    try {
      const u = new URL(href, base);
      if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      u.hash = "";
      if (!out.includes(u.toString()) && u.toString() !== base.toString()) out.push(u.toString());
    } catch {}
  }
  return out;
}

function facebookIn(html: string) {
  const m = html.match(/https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|plugins|dialog|tr\?|login)[A-Za-z0-9._\-/%?=]+/i);
  return m ? m[0].replace(/["'<>].*$/, "") : null;
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|\d+\.\d+\.\d+\.\d+|\[.*\])$/i;

async function getPage(url: string) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) return null;
  const res = await fetch(u, {
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JPRLeadEngine/1.0)", Accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "text/html").includes("html")) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  // Read at most ~1.5 MB.
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 1_500_000) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return { html: new TextDecoder().decode(Buffer.concat(chunks)), url: new URL(res.url || u.toString()) };
}

async function siteEmails(website: string) {
  let first: Awaited<ReturnType<typeof getPage>> = null;
  try {
    first = await getPage(website);
  } catch {
    // Some small-business sites only answer on http, or only without "www".
    const alt = website.startsWith("https://") ? website.replace("https://", "http://") : null;
    if (alt) first = await getPage(alt).catch(() => null);
  }
  if (!first) return { emails: [] as string[], facebook: null as string | null, reached: false, source: new Map<string, string>() };
  const emails = new Set(emailsIn(first.html));
  // Where each email was found, like WellThree's "email source" column.
  const source = new Map<string, string>([...emails].map((e) => [e, "website"]));
  let facebook = facebookIn(first.html);
  const links = contactLinks(first.html, first.url);
  if (!links.length) links.push(new URL("/contact", first.url).toString(), new URL("/contact-us", first.url).toString());
  for (const link of links.slice(0, 3)) {
    const page = await getPage(link).catch(() => null);
    if (!page) continue;
    for (const e of emailsIn(page.html)) {
      emails.add(e);
      if (!source.has(e)) source.set(e, "contact page");
    }
    facebook ??= facebookIn(page.html);
  }
  return { emails: [...emails], facebook, reached: true, source };
}

const GOOD_LOCAL = /^(info|contact|office|hello|general|admin|sales|hr|careers|jobs|hiring|mail|inquir|enquir|service|customerservice)/i;

// The address a campaign should use: the business's own domain first, a named person or info@ over others,
// a free-mail address only when the site shows nothing else.
export function pickPrimary(emails: string[], domain: string | null, owner: string | null) {
  const ownerWords = normName(owner).split(" ").filter((w) => w.length > 2);
  const score = (e: string) => {
    const [local, d] = e.split("@");
    let s = 0;
    if (domain && (d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`))) s += 100;
    else if (FREE_MAIL.test(d)) s += 40;
    if (ownerWords.some((w) => local.includes(w))) s += 20;
    if (GOOD_LOCAL.test(local)) s += 15;
    if (/^(webmaster|privacy|legal|abuse|postmaster|billing|accounts?payable|ap|invoice)/.test(local)) s -= 30;
    return s;
  };
  // An address on some other company's domain (their web designer, a supplier) doesn't count.
  const usable = emails.filter((e) => score(e) >= 40 || !domain);
  return usable.sort((a, b) => score(b) - score(a))[0] ?? null;
}

async function hasMx(domain: string, cache: Map<string, Promise<boolean>>) {
  if (!cache.has(domain))
    cache.set(
      domain,
      Promise.race([
        resolveMx(domain).then((r) => r.length > 0),
        new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error("dns timeout")), 5000)),
      ]).catch((e: NodeJS.ErrnoException) => {
        if (e?.code === "ENOTFOUND" || e?.code === "ENODATA") return false;
        throw e;
      }),
    );
  return cache.get(domain)!;
}

// ---------------------------------------------------------------- PA business registry (owner names)

const TITLE_RANK = ["owner", "president", "ceo", "managing member", "principal", "member", "manager", "governor", "partner", "director", "officer", "vice president", "secretary", "treasurer"];

function titleRank(t: string) {
  const l = t.toLowerCase();
  const i = TITLE_RANK.findIndex((r) => l.includes(r));
  return i === -1 ? 99 : i;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => "Mc" + c.toUpperCase());

type RegistryRow = { business_name?: string; party_type?: string; first_name?: string; last_name?: string; shortcountyname?: string };

// Pennsylvania's free business registry (data.pa.gov): the owner or officer on file for this business name.
export async function paOwner(name: string, county: string | null) {
  const want = normName(name);
  if (!want) return null;
  const url = new URL("https://data.pa.gov/resource/xvd7-5r2c.json");
  url.searchParams.set("$q", want);
  url.searchParams.set("$where", "first_name IS NOT NULL");
  url.searchParams.set("$select", "business_name,party_type,first_name,last_name,shortcountyname");
  url.searchParams.set("$limit", "100");
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`PA registry ${res.status}`);
  const rows = ((await res.json()) as RegistryRow[]).filter((r) => normName(r.business_name) === want && r.first_name && r.last_name);
  if (!rows.length) return null;
  // The same name registered in more than one county is ambiguous unless one is the county we searched.
  const countyName = (county ?? "").replace(/\s+county$/i, "").toLowerCase();
  const counties = new Set(rows.map((r) => (r.shortcountyname ?? "").toLowerCase()));
  const pool = counties.size === 1 ? rows : rows.filter((r) => (r.shortcountyname ?? "").toLowerCase() === countyName);
  if (!pool.length) return null;
  const best = pool.sort((a, b) => titleRank(a.party_type ?? "") - titleRank(b.party_type ?? ""))[0];
  return { name: titleCase(`${best.first_name} ${best.last_name}`.trim()), title: best.party_type?.trim() || null };
}

// ---------------------------------------------------------------- Bouncer (mailbox check)

// Bouncer pay-as-you-go: about $8 per 1,000 checks.
export const BOUNCER_COST = 0.008;

async function runBouncer(db: DB, secret: string, key: string, more: () => boolean) {
  let done = 0;
  const spend = new Map<string | null, number>();
  try {
    while (more()) {
      const { data: batch, error } = await db.rpc("leads_claim_verify", { p_secret: secret, p_limit: 20 });
      if (error) throw new Error(error.message);
      if (!batch?.length) break;
      let stop = false;
      await pool(batch, 5, async (b) => {
        if (stop) {
          await db.rpc("leads_verify_failed", { p_secret: secret, p_id: b.id });
          return;
        }
        try {
          const url = new URL("https://api.usebouncer.com/v1.1/email/verify");
          url.searchParams.set("email", b.email);
          url.searchParams.set("timeout", "10");
          const res = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(20000) });
          if ([401, 402, 403, 429].includes(res.status)) {
            stop = true;
            throw new Error(`Bouncer ${res.status}: ${(await res.text()).slice(0, 150)}`);
          }
          if (!res.ok) throw new Error(`Bouncer ${res.status}`);
          const body = (await res.json()) as { status?: string; reason?: string };
          const status = ["deliverable", "risky", "undeliverable", "unknown"].includes(body.status ?? "") ? body.status! : "unknown";
          await db.rpc("leads_save_verify", { p_secret: secret, p_id: b.id, p_email: b.email, p_result: status, p_reason: body.reason ?? null });
          spend.set(b.search_id, (spend.get(b.search_id) ?? 0) + 1);
          done++;
        } catch (e) {
          await db.rpc("leads_verify_failed", { p_secret: secret, p_id: b.id });
          if (stop) throw e;
        }
      }).catch((e) => {
        stop = true;
        throw e;
      });
      if (stop) break;
    }
  } finally {
    for (const [search, units] of spend)
      await db.rpc("leads_log_spend", { p_secret: secret, p_service: "bouncer", p_units: units, p_cost: units * BOUNCER_COST, p_search: search });
  }
  return done;
}

// ---------------------------------------------------------------- Bright Data (Facebook page emails)

// Bright Data's Facebook Pages scraper: about $1.50 per 1,000 pages.
export const BRIGHTDATA_COST = 0.0015;
const FB_DATASET = "gd_mf124a0511bauquyow";

type FbRecord = {
  url?: string;
  input?: { url?: string };
  emails?: string[] | null;
  email?: string | null;
  contact_and_basic_info?: { contact_info?: { emails?: string[] | null } | null } | null;
};

async function runFacebook(db: DB, secret: string, key: string) {
  const auth = { Authorization: `Bearer ${key}` };
  let started = 0;
  let finished = 0;
  // Collect what earlier ticks sent.
  const { data: snaps } = await db.rpc("leads_fb_snapshots", { p_secret: secret });
  for (const s of snaps ?? []) {
    const prog = await fetch(`https://api.brightdata.com/datasets/v3/progress/${encodeURIComponent(s.snapshot_id)}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    const p = prog.ok ? ((await prog.json()) as { status?: string }) : { status: prog.status === 404 ? "failed" : "unknown" };
    const old = Date.now() - new Date(s.started_at).getTime() > 2 * 3600_000;
    if (p.status === "ready") {
      const res = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(s.snapshot_id)}?format=json`, { headers: auth, signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const rows = (await res.json()) as FbRecord[];
      for (const r of Array.isArray(rows) ? rows : []) {
        const url = r.input?.url ?? r.url;
        if (!url) continue;
        const found = emailsIn([...(r.emails ?? []), r.email ?? "", ...(r.contact_and_basic_info?.contact_info?.emails ?? [])].join(" "));
        await db.rpc("leads_fb_save", { p_secret: secret, p_snapshot: s.snapshot_id, p_url: url, p_emails: found, p_primary: pickPrimary(found, null, null) });
      }
      await db.rpc("leads_fb_close", { p_secret: secret, p_snapshot: s.snapshot_id, p_failed: false });
      await db.rpc("leads_log_spend", { p_secret: secret, p_service: "brightdata", p_units: Array.isArray(rows) ? rows.length : 0, p_cost: (Array.isArray(rows) ? rows.length : 0) * BRIGHTDATA_COST, p_search: null });
      finished++;
    } else if (p.status === "failed" || p.status === "canceled" || old) {
      await db.rpc("leads_fb_close", { p_secret: secret, p_snapshot: s.snapshot_id, p_failed: true });
    }
  }
  // Send the next batch.
  const { data: batch, error } = await db.rpc("leads_claim_fb", { p_secret: secret, p_limit: 50 });
  if (error) throw new Error(error.message);
  if (batch?.length) {
    let snapshot: string | null = null;
    try {
      const res = await fetch(`https://api.brightdata.com/datasets/v3/trigger?dataset_id=${FB_DATASET}&include_errors=true`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ input: batch.map((b) => ({ url: b.facebook_url })) }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) snapshot = ((await res.json()) as { snapshot_id?: string }).snapshot_id ?? null;
      else console.error("Bright Data trigger failed", res.status, (await res.text()).slice(0, 200));
    } finally {
      await db.rpc("leads_fb_started", { p_secret: secret, p_ids: batch.map((b) => b.id), p_snapshot: snapshot });
    }
    if (snapshot) started = batch.length;
  }
  return `${started} sent, ${finished} batches back`;
}

// ---------------------------------------------------------------- The tick

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export async function runLeadsTick(db: DB, secret: string) {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const report = { searches: 0, held: false, enriched: 0, verified: 0, facebook: "", errors: [] as string[] };

  // 1. Google Maps searches, three at a time, for up to ~45 seconds.
  const key = process.env.SERPER_API_KEY?.trim();
  if (key) {
    let stop = false;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (!stop && elapsed() < 45_000 && report.searches < 45) {
          const { data, error } = await db.rpc("leads_claim_task", { p_secret: secret });
          if (error) {
            report.errors.push(`claim: ${error.message}`);
            stop = true;
            return;
          }
          const task = data?.[0];
          if (!task) return;
          report.searches++;
          try {
            const { places, rawCount } = await serperPlaces(key, searchQuery(task.keyword, task.county, task.state), task.page);
            const r = await db.rpc("leads_save_task", { p_secret: secret, p_task: task.id, p_places: places, p_full: rawCount >= 10, p_error: null });
            if (r.error) report.errors.push(`save: ${r.error.message}`);
          } catch (e) {
            const held = e instanceof Hold;
            if (held) {
              report.held = true;
              stop = true;
            }
            const msg = e instanceof Error ? e.message : String(e);
            const r = await db.rpc("leads_save_task", { p_secret: secret, p_task: task.id, p_places: [], p_full: false, p_error: held ? `HOLD: ${msg}` : msg });
            if (r.error) report.errors.push(`save error: ${r.error.message}`);
          }
        }
      }),
    );
  }

  // 2. Websites and owner names, six at a time, until ~100 seconds in.
  const mx = new Map<string, Promise<boolean>>();
  while (elapsed() < 100_000) {
    const { data: batch, error } = await db.rpc("leads_claim_enrich", { p_secret: secret, p_limit: 12 });
    if (error) {
      report.errors.push(`enrich claim: ${error.message}`);
      break;
    }
    if (!batch?.length) break;
    await pool(batch, 6, async (b) => {
      try {
        const site = b.website ? await siteEmails(b.website) : { emails: [], facebook: null, reached: false, source: new Map<string, string>() };
        let owner: Awaited<ReturnType<typeof paOwner>> = null;
        if (b.state === "PA") owner = await paOwner(b.name, b.county).catch(() => null);
        const primary = pickPrimary(site.emails, b.domain, owner?.name ?? null);
        let status: string | null = null;
        if (primary) status = await hasMx(primary.split("@")[1], mx).then(
            (ok) => (ok ? "mx_ok" : "no_mx"),
            () => "unchecked",
          );
        const { error: e2 } = await db.rpc("leads_save_enrich", {
          p_secret: secret,
          p_id: b.id,
          p_emails: site.emails.slice(0, 20),
          p_primary: primary,
          p_email_status: status,
          p_facebook: site.facebook,
          p_owner_name: owner?.name ?? null,
          p_owner_title: owner?.title ?? null,
          p_error: null,
          p_source: primary ? (site.source.get(primary) ?? "website") : null,
        });
        if (e2) report.errors.push(`enrich save: ${e2.message}`);
        else report.enriched++;
      } catch (e) {
        await db.rpc("leads_save_enrich", {
          p_secret: secret,
          p_id: b.id,
          p_emails: [],
          p_primary: null,
          p_email_status: null,
          p_facebook: null,
          p_owner_name: null,
          p_owner_title: null,
          p_error: e instanceof Error ? e.message : String(e),
          p_source: null,
        });
      }
    });
  }

  // 3. The free domain check for emails that came from Facebook pages.
  const { data: needMx } = await db.rpc("leads_needs_mx", { p_secret: secret, p_limit: 50 });
  await pool(needMx ?? [], 8, async (r) => {
    const status = await hasMx(r.email.split("@")[1], mx).then(
      (ok) => (ok ? "mx_ok" : "no_mx"),
      () => "unchecked",
    );
    await db.rpc("leads_set_email_status", { p_secret: secret, p_id: r.id, p_status: status });
  });

  // 4. Bouncer: does the mailbox itself exist? (WellThree's "verified" emails.)
  const bouncer = process.env.BOUNCER_API_KEY?.trim();
  if (bouncer && elapsed() < 130_000) {
    try {
      report.verified = await runBouncer(db, secret, bouncer, () => elapsed() < 140_000);
    } catch (e) {
      report.errors.push(`bouncer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 5. Bright Data: emails off the Facebook pages of businesses whose website had none.
  const brightdata = process.env.BRIGHTDATA_API_KEY?.trim();
  if (brightdata) {
    try {
      report.facebook = await runFacebook(db, secret, brightdata);
    } catch (e) {
      report.errors.push(`facebook: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 6. Once an hour, re-check every lead against Companies (a prospect may have become a client).
  if (new Date().getUTCMinutes() < 2) {
    const { error } = await db.rpc("leads_recheck_companies", { p_secret: secret });
    if (error) report.errors.push(`recheck: ${error.message}`);
  }
  return report;
}
