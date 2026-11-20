// The master lead list as CSV (Justin, 2026-11-12): used by the owner download and the Google Sheet link.
import { isDirectoryEmail, isDirectorySite } from "@/lib/directory-sites";

type P = { name: string; title: string | null };

export const COLS = [
  "Business", "County", "City", "Address", "Phone", "Website", "Email", "Other emails", "Est. employees", "Size",
  "What they do", "Category", "Registry contact", "Registry title", "People on website", "Hiring", "Careers page",
  "Facebook", "Google rating", "Reviews", "PPP jobs", "Entity type", "Registered", "Confidence", "Why", "Filing #",
];

// The columns of Justin's Google Sheet "JPR Local Master Lead List", in its order.
export const SHEET_COLS = [
  "Business", "County", "City", "Address", "Phone", "Website", "Email", "Est. employees", "Registry contact",
  "Registry title", "People on website", "Hiring", "What they do",
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

export function leadCsv(rows: Record<string, unknown>[], cols: readonly string[] = COLS, header = true) {
  const pick = cols.map((c) => COLS.indexOf(c));
  const lines = header ? [cols.join(",")] : [];
  for (const r of rows) {
    const x = (r.research ?? {}) as Record<string, unknown>;
    const people = Array.isArray(x.people) ? (x.people as P[]).map((p) => (p.title ? `${p.name} (${p.title})` : p.name)).join("; ") : "";
    // Rows researched before the directory filter can carry a directory or government page as the website, and emails
    // read off it: leave those out.
    const dir = isDirectorySite(r.website as string | null);
    const ok = (e: unknown): e is string => typeof e === "string" && !dir && !isDirectoryEmail(e);
    const good = (Array.isArray(r.emails) ? (r.emails as unknown[]) : []).filter(ok);
    // Only the address the research picked as the business's own; the rest can be a web designer's or a supplier's.
    const email = ok(r.email) ? r.email : null;
    const emails = good.filter((e) => e !== email).join("; ");
    const values = [
      r.name, r.county, r.city, r.maps_address ?? r.address, phone(r.phone), dir ? null : r.website, email, emails, r.employees_est, r.size_guess,
      x.what_they_do, r.category, r.contact, r.contact_title, people, x.hiring === true ? "Yes" : x.hiring === false ? "No" : "",
      x.careers_url, x.facebook, r.rating, r.reviews, r.ppp_jobs, r.entity_type, r.registered_on, x.confidence, x.evidence, r.filing,
    ];
    lines.push(pick.map((i) => cell(values[i])).join(","));
  }
  return lines.join("\r\n");
}
