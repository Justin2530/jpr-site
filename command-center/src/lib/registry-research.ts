import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getPage } from "@/lib/leads";

// Research agent for the PA registry list (Justin, 2026-11-11). Kept out of the Command Center screens:
// it fills the hidden lead_registry table and the results go to him as a spreadsheet.
// For each business: one Google search through Bright Data's SERP API, a read of its own website,
// then a small AI read of both that pulls out the facts and guesses whether it has 5+ employees.

type DB = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["lead_registry"]["Row"];

export const SERP_COST = 0.0015;
const zone = () => process.env.BRIGHTDATA_SERP_ZONE?.trim() || "jpr_serp";

export async function serp(key: string, q: string) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&gl=us&hl=en&brd_json=1`;
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone: zone(), url, format: "raw" }),
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  if (!res.ok) throw new SerpHold(`Bright Data ${res.status}: ${text.slice(0, 200)}`, res.status);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Bright Data sent no JSON: ${text.slice(0, 120)}`);
  }
}

export class SerpHold extends Error {
  constructor(msg: string, public status: number) {
    super(msg);
  }
}

// The parts of Google's page worth reading: the business panel, local results and the top links.
function trimSerp(j: Record<string, unknown>) {
  const pick = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : v);
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (/image|thumbnail|logo|icon|favicon|^rank$|global_rank|extensions|sitelinks|^url$/i.test(k) && k !== "url") continue;
        if (typeof x === "string" && x.startsWith("data:")) continue;
        o[k] = strip(x);
      }
      return o;
    }
    return typeof v === "string" ? v.slice(0, 400) : v;
  };
  return strip({
    knowledge: j.knowledge,
    local: pick(j.snack_pack ?? j.local_results ?? j.local_pack, 3),
    organic: pick(j.organic, 7),
  });
}

function pageText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OWN_SITE_SKIP = /(facebook|instagram|linkedin|yelp|bbb|yellowpages|mapquest|manta|bizapedia|opencorporates|dnb|zoominfo|buzzfile|corporationwiki|indeed|glassdoor|google|youtube|twitter|x\.com|tiktok|nextdoor|angi|homeadvisor|thumbtack|houzz|porch|chamberofcommerce|allbiz|zaubacorp|pa\.gov|sba\.gov|govtribe|bloomberg|dandb)\./i;

async function siteText(serpJson: Record<string, unknown>) {
  // The business's own site: the panel's website, else the first top link that isn't a directory.
  const k = (serpJson.knowledge ?? {}) as Record<string, unknown>;
  const candidates: string[] = [];
  for (const v of Object.values(k)) if (typeof v === "string" && /^https?:\/\//.test(v) && !OWN_SITE_SKIP.test(v)) candidates.push(v);
  for (const o of (Array.isArray(serpJson.organic) ? serpJson.organic : []).slice(0, 4) as Record<string, unknown>[]) {
    const link = typeof o.link === "string" ? o.link : null;
    if (link && !OWN_SITE_SKIP.test(link)) candidates.push(link);
  }
  for (const url of candidates.slice(0, 2)) {
    try {
      const home = await getPage(new URL("/", url).toString());
      if (!home) continue;
      let text = pageText(home.html).slice(0, 2500);
      const about = home.html.match(/href=["']([^"']*(about|team|staff|careers|jobs|employment)[^"']*)["']/i)?.[1];
      if (about) {
        const p = await getPage(new URL(about, home.url).toString()).catch(() => null);
        if (p) text += " | ABOUT/CAREERS: " + pageText(p.html).slice(0, 2000);
      }
      return { site: home.url.toString(), text };
    } catch {}
  }
  return { site: null as string | null, text: "" };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    found: { type: "boolean" },
    closed: { type: "boolean" },
    website: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    category: { type: ["string", "null"] },
    rating: { type: ["number", "null"] },
    reviews: { type: ["integer", "null"] },
    facebook: { type: ["string", "null"] },
    what_they_do: { type: ["string", "null"] },
    employees_est: { type: ["integer", "null"] },
    size_guess: { type: "string", enum: ["5+", "under 5", "unknown"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: { type: "string" },
  },
  required: ["found", "closed", "website", "phone", "address", "category", "rating", "reviews", "facebook", "what_they_do", "employees_est", "size_guess", "confidence", "evidence"],
};

const RULES = `You research one small business in western Pennsylvania for a recruiting firm that only wants employers with 5 or more employees.
You get the state registry record, a Google results page (JSON) and text from the business's website, if found.
- found: true only if the Google results clearly show this same business (same or very close name, same town or county). Directories that only repeat the state filing (bizapedia, opencorporates, corporationwiki) do not count as found.
- closed: true if Google says permanently closed, or the business is clearly gone.
- Copy website, phone, address, category, rating, review count and Facebook page only from the results; never invent them.
- employees_est: your best whole-number estimate of employees, or null if there is nothing to go on. Use stated employee counts first (website, LinkedIn "11-50 employees", PPP or retirement-plan counts given), then signals: number of locations, trucks, crews, shifts, job postings, staff pages, review volume (a shop with 100+ reviews is rarely 1-2 people), type of business (a manufacturer, nursing home or trucking company is usually 5+; a solo consultant, rental property or holding LLC is under 5).
- size_guess: "5+" or "under 5" when the evidence leans that way, "unknown" when you can't tell or nothing was found.
- evidence: one short plain sentence saying why.`;

async function judge(row: Row, serpJson: Record<string, unknown>, site: { site: string | null; text: string }) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      instructions: RULES,
      input: JSON.stringify({
        registry: { name: row.name, entity_type: row.entity_type, registered: row.registered_on, address: row.address, city: row.city, county: row.county, owner: row.contact },
        ppp_jobs_reported_2020_21: row.ppp_jobs,
        retirement_plan_participants: row.plan_people,
        google: trimSerp(serpJson),
        website: site.site,
        website_text: site.text || null,
      }),
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "business", schema: SCHEMA, strict: true } },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const out = (data.output ?? []).flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? []).find((c: { type: string }) => c.type === "output_text")?.text;
  return JSON.parse(out) as Record<string, unknown> & { size_guess: string; employees_est: number | null };
}

export async function researchOne(key: string, row: Row) {
  const town = row.city ? `${row.city} PA` : `${row.county} County PA`;
  const s = await serp(key, `${row.name.replace(/,?\s+(llc|inc\.?|incorporated|corp\.?|co\.?|ltd\.?)$/i, "")} ${town}`);
  const site = await siteText(s);
  const v = await judge(row, s, site);
  return {
    website: (v.website as string | null) ?? site.site,
    phone: v.phone,
    rating: v.rating,
    reviews: v.reviews,
    category: v.category,
    closed: v.closed,
    maps_address: v.address,
    employees_est: v.employees_est,
    size_guess: v.size_guess,
    research: { found: v.found, facebook: v.facebook, what_they_do: v.what_they_do, confidence: v.confidence, evidence: v.evidence },
  };
}

export async function runRegistryTick(db: DB, secret: string) {
  const started = Date.now();
  const report = { researched: 0, errors: [] as string[], held: false };
  const key = process.env.BRIGHTDATA_API_KEY?.trim();
  if (!key) return { ...report, errors: ["no Bright Data key"] };
  while (Date.now() - started < 200_000 && !report.held) {
    const { data: batch, error } = await db.rpc("lead_registry_claim", { p_secret: secret, p_limit: 12 });
    if (error) throw new Error(error.message);
    if (!batch?.length) break;
    await Promise.all(
      batch.map(async (row) => {
        if (report.held) {
          await db.rpc("lead_registry_release", { p_secret: secret, p_filing: row.filing });
          return;
        }
        try {
          const data = await researchOne(key, row);
          const r = await db.rpc("lead_registry_save", { p_secret: secret, p_filing: row.filing, p_data: data as unknown as Json });
          if (r.error) report.errors.push(`save: ${r.error.message}`);
          else report.researched++;
        } catch (e) {
          // No credits, a bad key or zone: stop and give the try back.
          if (e instanceof SerpHold && [401, 402, 403, 407, 429].includes(e.status)) {
            report.held = true;
            await db.rpc("lead_registry_release", { p_secret: secret, p_filing: row.filing });
          }
          if (report.errors.length < 5) report.errors.push(e instanceof Error ? e.message : String(e));
        }
      }),
    );
  }
  return report;
}
