// The master lead list as CSV (Justin, 2026-11-12): used by the owner download and the Google Sheet link.
import { isDirectoryEmail, isDirectorySite } from "@/lib/directory-sites";
import { FREE_MAIL, pickPrimary } from "@/lib/leads";

type P = { name: string; title: string | null };
type Row = Record<string, unknown>;

export const COLS = [
  "Business", "County", "City", "Address", "Phone", "Website", "Email", "Other emails", "Est. employees", "Size",
  "What they do", "Category", "Registry contact", "Registry title", "People on website", "Hiring", "Careers page",
  "Facebook", "Google rating", "Reviews", "PPP jobs", "Entity type", "Registered", "Confidence", "Why", "Filing #",
  "Same location as",
];

// The columns of Justin's Google Sheet "JPR Local Master Lead List", in its order. One row per company and place
// (2026-11-20: "i just dont want any duplicates as far as compnaies/locations"): a business marked same_location_as
// another folds into that row and is listed under "Also at this location". "Filing #" is the kept row's registry
// number, hidden in the Sheet, so a later refresh can find the row again.
export const SHEET_COLS = [
  "Business", "County", "City", "Address", "Phone", "Website", "Email", "Other emails", "Est. employees", "Registry contact",
  "Registry title", "People on website", "Hiring", "What they do", "Also at this location", "Filing #",
];

function cell(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// US numbers written one way, "(814) 938-1234", so they read alike and a sheet doesn't turn bare digits into a number.
function phone(v: unknown) {
  if (typeof v !== "string") return v;
  const m = /^1?(\d{3})(\d{3})(\d{4})$/.exec(v.replace(/\D/g, ""));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : v;
}

// One business's values, by column name.
function values(r: Row): Record<string, unknown> {
  const x = (r.research ?? {}) as Record<string, unknown>;
  const people = Array.isArray(x.people) ? (x.people as P[]).map((p) => (p.title ? `${p.name} (${p.title})` : p.name)).join("; ") : "";
  // Rows researched before the directory filter can carry a directory or government page as the website, and emails
  // read off it: leave those out.
  const dir = isDirectorySite(r.website as string | null);
  const ok = (e: unknown): e is string => typeof e === "string" && !dir && !isDirectoryEmail(e);
  const good = (Array.isArray(r.emails) ? (r.emails as unknown[]) : []).filter(ok);
  // Only the address the research picked as the business's own; the rest can be a web designer's or a supplier's.
  // Emails off the business's Facebook page (fb_emails, lead_registry_fb) are its own whatever their domain.
  const fb = (Array.isArray(r.fb_emails) ? (r.fb_emails as unknown[]) : []).filter((e): e is string => typeof e === "string" && !isDirectoryEmail(e));
  const email = ok(r.email) ? r.email : pickPrimary(fb, null, (r.contact as string | null) ?? null);
  let domain: string | null = null;
  try {
    const w = r.website && !dir ? String(r.website) : null;
    domain = w ? new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {}
  // Other emails: the rest of the business's own addresses (its domain, or free mail like yahoo), then Facebook's.
  const own = (e: string) => {
    const d = e.split("@")[1]?.toLowerCase() ?? "";
    return FREE_MAIL.test(d) || (!!domain && (d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`)));
  };
  const emails = [...new Set([...good.filter(own), ...fb])].filter((e) => e !== email).join("; ");
  return {
    Business: r.name, County: r.county, City: r.city, Address: r.maps_address ?? r.address, Phone: phone(r.phone),
    Website: dir ? null : r.website, Email: email, "Other emails": emails, "Est. employees": r.employees_est, Size: r.size_guess,
    "What they do": x.what_they_do, Category: r.category, "Registry contact": r.contact, "Registry title": r.contact_title,
    "People on website": people, Hiring: x.hiring === true ? "Yes" : x.hiring === false ? "No" : "", "Careers page": x.careers_url,
    Facebook: x.facebook, "Google rating": r.rating, Reviews: r.reviews, "PPP jobs": r.ppp_jobs, "Entity type": r.entity_type,
    Registered: r.registered_on, Confidence: x.confidence, Why: x.evidence, "Filing #": r.filing,
  };
}

export function leadCsv(rows: Row[], cols: readonly string[] = COLS, header = true) {
  const names = new Map(rows.map((r) => [r.filing, r.name]));
  const lines = header ? [cols.join(",")] : [];
  for (const r of rows) {
    const v = values(r);
    v["Same location as"] = r.same_location_as ? (names.get(r.same_location_as) ?? r.same_location_as) : null;
    lines.push(cols.map((c) => cell(v[c])).join(","));
  }
  return lines.join("\r\n");
}

const filled = (v: unknown) => v !== null && v !== undefined && v !== "";
const split = (v: unknown) => (typeof v === "string" && v ? v.split("; ") : []);
const houseNumber = (v: unknown) => (typeof v === "string" ? /^\s*(\d+)/.exec(v)?.[1] ?? null : null);

// The Sheet's rows: one per company and place. Each business marked same_location_as another folds into that row: the
// row keeps its own details, fills gaps from the others, gathers every email and person, and names the others with their
// registry contact (and their phone or street number when it differs). Rows come in Sheet order (most employees first)
// and a merged row takes the place of its first business, so the biggest number still sorts it.
export function sheetLines(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = String(r.same_location_as ?? r.filing);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const lines: string[] = [];
  for (const [key, g] of groups) {
    const kept = g.find((r) => r.filing === key) ?? g[0];
    const others = g.filter((r) => r !== kept);
    const v = values(kept);
    const all = [v, ...others.map(values)];
    if (others.length) {
      for (const c of ["County", "City", "Address", "Phone", "Website", "What they do"]) if (!filled(v[c])) v[c] = all.find((x) => filled(x[c]))?.[c] ?? null;
      if (!filled(v.Email)) v.Email = all.find((x) => filled(x.Email))?.Email ?? null;
      const seen = new Set([String(v.Email ?? "").toLowerCase()]);
      v["Other emails"] = all.flatMap((x) => [x.Email, ...split(x["Other emails"])]).filter((e): e is string => {
        if (typeof e !== "string" || !e) return false;
        const k = e.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).join("; ");
      const sizes = all.map((x) => Number(x["Est. employees"])).filter((n) => Number.isFinite(n) && n > 0);
      v["Est. employees"] = sizes.length ? Math.max(...sizes) : v["Est. employees"];
      if (!filled(v["Registry contact"])) {
        const c = all.find((x) => filled(x["Registry contact"]));
        if (c) [v["Registry contact"], v["Registry title"]] = [c["Registry contact"], c["Registry title"]];
      }
      // Each person once: "Michael Herald (Owner)" covers "michael herald (owner)" and a bare "Michael Herald".
      const people = [...new Map(all.flatMap((x) => split(x["People on website"])).map((p) => [p.toLowerCase(), p] as const)).values()];
      const titled = new Set(people.filter((p) => p.includes(" (")).map((p) => p.slice(0, p.indexOf(" (")).toLowerCase()));
      v["People on website"] = people.filter((p) => p.includes(" (") || !titled.has(p.toLowerCase())).join("; ");
      v.Hiring = all.some((x) => x.Hiring === "Yes") ? "Yes" : all.some((x) => x.Hiring === "No") ? "No" : "";
      v["Also at this location"] = others.map((o) => {
        const ov = values(o);
        const contact = ov["Registry contact"] ? [ov["Registry contact"], ov["Registry title"]].filter(filled).join(", ") : null;
        const tel = filled(ov.Phone) && ov.Phone !== v.Phone ? ov.Phone : null;
        const n = houseNumber(ov.Address);
        const where = n && houseNumber(v.Address) && n !== houseNumber(v.Address) ? ov.Address : null;
        const extra = [contact, tel, where].filter(filled).join("; ");
        return extra ? `${o.name} (${extra})` : String(o.name);
      }).join(" | ");
    }
    lines.push(SHEET_COLS.map((c) => cell(v[c])).join(","));
  }
  return lines;
}
