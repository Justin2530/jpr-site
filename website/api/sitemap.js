// /sitemap.xml: static public pages plus every open public job.
const { SITE, jobPostings, esc } = require("./_shared");

const PAGES = [
  { loc: "/", priority: "1.0", changefreq: "weekly" },
  { loc: "/privacy-policy", priority: "0.2", changefreq: "yearly" },
  { loc: "/terms-and-conditions", priority: "0.2", changefreq: "yearly" },
];

module.exports = async (req, res) => {
  let jobs = [];
  try { jobs = await jobPostings(); } catch (e) { console.error(e); }
  const urls = PAGES.map((p) => `<url><loc>${SITE}${p.loc}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`)
    .concat(jobs.map((j) => `<url><loc>${SITE}/jobs/${esc(j.id)}</loc><lastmod>${String(j.updated_at || j.opened_on).slice(0, 10)}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`));
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`);
};
