// Shared helpers for the public site's server-rendered SEO routes (sitemap, job pages).
const SITE = "https://www.jpeacerecruiting.com";
const SB = "https://iobrwlgubowkxyjtxeib.supabase.co/rest/v1/rpc/";
const KEY = "sb_publishable_xy4ZXbWgeeAP8D0xqhk17w_MFtgUXMy"; // publishable key, already public in index.html

async function jobPostings() {
  const r = await fetch(SB + "site_job_postings", {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error("site_job_postings " + r.status);
  return r.json();
}

const esc = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = { SITE, jobPostings, esc };
