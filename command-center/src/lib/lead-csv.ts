// The master lead list as CSV (Justin, 2026-11-12): used by the owner download and the Google Sheet link.
type P = { name: string; title: string | null };

export const COLS = [
  "Business", "County", "City", "Address", "Phone", "Website", "Email", "Other emails", "Est. employees", "Size",
  "What they do", "Category", "Registry contact", "Registry title", "People on website", "Hiring", "Careers page",
  "Facebook", "Google rating", "Reviews", "PPP jobs", "Entity type", "Registered", "Confidence", "Why", "Filing #",
];

function cell(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function leadCsv(rows: Record<string, unknown>[]) {
  const lines = [COLS.join(",")];
  for (const r of rows) {
    const x = (r.research ?? {}) as Record<string, unknown>;
    const people = Array.isArray(x.people) ? (x.people as P[]).map((p) => (p.title ? `${p.name} (${p.title})` : p.name)).join("; ") : "";
    const emails = Array.isArray(r.emails) ? (r.emails as string[]).filter((e) => e !== r.email).join("; ") : "";
    lines.push(
      [
        r.name, r.county, r.city, r.maps_address ?? r.address, r.phone, r.website, r.email, emails, r.employees_est, r.size_guess,
        x.what_they_do, r.category, r.contact, r.contact_title, people, x.hiring === true ? "Yes" : x.hiring === false ? "No" : "",
        x.careers_url, x.facebook, r.rating, r.reviews, r.ppp_jobs, r.entity_type, r.registered_on, x.confidence, x.evidence, r.filing,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
