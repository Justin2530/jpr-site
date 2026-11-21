import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { emailsIn } from "@/lib/leads";
import { isDirectoryEmail } from "@/lib/directory-sites";
import { domainFits } from "@/lib/lead-csv";
import { serp, SerpHold } from "@/lib/registry-research";
import { fbPage, pageIsTheirs, resultPage, titleMatches } from "@/lib/registry-facebook";

// Second email pass for the master lead list (Justin 2026-11-21: "we need to get as mmany emails a possible").
// Every Sheet business still without an email gets a Google search for "<name> <town> PA email" (directories,
// chamber pages and Facebook often print the address right in the snippet) and, when no Facebook page is known,
// "<name> <town> PA facebook". Hidden: fills lead_registry_esearch and queues pages in lead_registry_fb.

type DB = SupabaseClient<Database>;
const HOLD = [401, 402, 403, 407, 429];

const hostOf = (u: string | null) => {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

type Row = { filing: string; name: string; city: string | null; county: string | null; website: string | null; need_fb: boolean };

function texts(o: Record<string, unknown>) {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.values(v).forEach(add);
  };
  for (const [k, v] of Object.entries(o)) if (!/image|thumbnail|logo|icon|favicon/i.test(k)) add(v);
  return parts.join(" ");
}

// Emails in the results that belong to this business: the address's domain is the business's own (its website or
// its name), or it sits in a result titled with the business's name (a free-mail or other address on its own
// Facebook page or directory listing).
function pickEmails(row: Row, j: Record<string, unknown>) {
  const site = hostOf(row.website);
  const out = new Map<string, string>();
  const consider = (o: Record<string, unknown>, titled: boolean, where: string) => {
    for (const e of emailsIn(texts(o))) {
      if (isDirectoryEmail(e) || out.has(e)) continue;
      const d = e.split("@")[1];
      const own = (site && (d === site || site.endsWith(`.${d}`) || d.endsWith(`.${site}`))) || domainFits(row.name, d);
      if (own || titled) out.set(e, where);
    }
  };
  const knowledge = j.knowledge as Record<string, unknown> | undefined;
  if (knowledge && typeof knowledge === "object") {
    const t = typeof knowledge.name === "string" ? knowledge.name : typeof knowledge.title === "string" ? knowledge.title : "";
    consider(knowledge, titleMatches(row.name, t), "google panel");
  }
  const organic = Array.isArray(j.organic) ? (j.organic as Record<string, unknown>[]) : [];
  for (const o of organic.slice(0, 10)) {
    const title = typeof o.title === "string" ? o.title : "";
    consider(o, titleMatches(row.name, title), typeof o.link === "string" ? o.link.slice(0, 150) : "result");
  }
  return out;
}

async function pickPage(row: Row, j: Record<string, unknown>) {
  const organic = Array.isArray(j.organic) ? (j.organic as Record<string, unknown>[]) : [];
  for (const o of organic.slice(0, 8)) {
    if (typeof o.title !== "string" || !titleMatches(row.name, o.title)) continue;
    const link = typeof o.link === "string" ? o.link : "";
    const crumb = typeof o.display_link === "string" ? o.display_link : "";
    if (!/facebook\.com/i.test(link + crumb) && !/google\.com\/goto/.test(link)) continue;
    const p = await resultPage(o);
    if (p && pageIsTheirs(row.name, p, o)) return p;
  }
  return null;
}

export async function searchOne(key: string, row: Row) {
  const town = row.city ? `${row.city} PA` : `${row.county} County PA`;
  const name = row.name.replace(/,?\s+(llc|inc\.?|incorporated|corp\.?|co\.?|ltd\.?)$/i, "");
  let searches = 0;
  const a = await serp(key, `${name} ${town} email`);
  searches++;
  const emails = pickEmails(row, a);
  let page = await pickPage(row, a);
  if (!page && row.need_fb) {
    const b = await serp(key, `${name} ${town} facebook`);
    searches++;
    for (const [e, w] of pickEmails(row, b)) if (!emails.has(e)) emails.set(e, w);
    page = await pickPage(row, b);
  }
  return { emails: [...emails.keys()], sources: Object.fromEntries(emails), page: page ? fbPage(page) : null, searches };
}

export async function runEmailSearch(db: DB, secret: string, opts: { limit?: number; seconds?: number } = {}) {
  const started = Date.now();
  const report = { searched: 0, with_email: 0, emails: 0, pages: 0, held: false, errors: [] as string[] };
  const note = (e: unknown) => {
    if (report.errors.length < 5) report.errors.push(e instanceof Error ? e.message : String(e));
  };
  const key = process.env.BRIGHTDATA_API_KEY?.trim();
  if (!key) return { ...report, errors: ["no Bright Data key"] };
  let left = opts.limit ?? Number.POSITIVE_INFINITY;
  const until = started + (opts.seconds ?? 100) * 1000;
  const worker = async () => {
    while (left > 0 && Date.now() < until && !report.held) {
      left--;
      const { data: rows, error } = await db.rpc("lead_registry_esearch_claim", { p_secret: secret, p_limit: 1 });
      if (error) throw new Error(error.message);
      const row = rows?.[0];
      if (!row) return;
      try {
        const r = await searchOne(key, row);
        const s = await db.rpc("lead_registry_esearch_save", {
          p_secret: secret, p_filing: row.filing, p_status: "done", p_emails: r.emails, p_fb_url: r.page,
          p_sources: r.sources as Json, p_error: null, p_searches: r.searches,
        });
        if (s.error) note(`save: ${s.error.message}`);
        report.searched++;
        if (r.emails.length) report.with_email++;
        report.emails += r.emails.length;
        if (r.page) report.pages++;
      } catch (e) {
        if ((e instanceof SerpHold && HOLD.includes(e.status)) || (e instanceof Error && /auto-throttled/i.test(e.message))) {
          await db.rpc("lead_registry_esearch_release", { p_secret: secret, p_filing: row.filing });
          if (e instanceof SerpHold) report.held = true;
        }
        note(e);
      }
    }
  };
  if (left > 0) await Promise.all(Array.from({ length: Math.min(8, left) }, worker));
  return report;
}
