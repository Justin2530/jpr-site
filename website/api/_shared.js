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

function page({ title, description, canonical, body, jsonld, css = "" }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">${canonical ? `<link rel="canonical" href="${canonical}">` : `<meta name="robots" content="noindex">`}
<link rel="icon" href="/img/logo-sm.webp"><meta property="og:type" content="website"><meta property="og:site_name" content="JPR"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${canonical ? `<meta property="og:url" content="${canonical}">` : ""}<meta property="og:image" content="${SITE}/img/og.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;color:#222328;background:#fff;font-family:'Source Sans 3',sans-serif;font-size:19px;line-height:1.65}a{color:inherit}.wrap{max-width:860px;margin:auto;padding:0 22px}header{border-bottom:1px solid #e6e2dc}header .wrap{display:flex;align-items:center;justify-content:space-between;min-height:84px;gap:16px}header img{width:100px;height:74px;object-fit:contain}nav a{font-weight:600;font-size:16px;margin-left:20px;text-decoration:none}.crumbs{font-size:14px;color:#6a6b70;margin:28px 0 8px}.crumbs a{text-decoration:underline}h1{font-family:Manrope,sans-serif;font-size:clamp(34px,5vw,52px);letter-spacing:-.03em;line-height:1.1;margin:0 0 12px}.meta{color:#5c5d61;font-size:18px;margin-bottom:28px}.desc p{margin:0 0 16px}.desc h2{font-family:Manrope,sans-serif;font-size:24px;letter-spacing:-.01em;line-height:1.25;margin:32px 0 10px}.desc ul{margin:0 0 18px;padding-left:22px}.desc li{margin:0 0 6px}.button{display:inline-flex;align-items:center;justify-content:center;padding:16px 26px;min-height:54px;font-size:18px;background:#b84520;color:#fff;font-weight:600;border-radius:3px;text-decoration:none;margin:12px 16px 12px 0}.button:hover{background:#903617}.note{background:#f4f2ee;border:1px solid #e6e2dc;padding:18px 20px;border-radius:4px;font-size:17px;margin:32px 0}footer{background:#f2f0ec;border-top:1px solid #ddd9d2;padding:28px 0;font-size:14px;color:#555;margin-top:48px}@media(max-width:600px){nav{display:none}}${css}</style>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><header><div class="wrap"><a href="/"><img src="/img/logo-sm.webp" width="248" height="183" alt="JPR Recruitment Services"></a><nav aria-label="Main navigation"><a href="/jobs">Open Jobs</a><a href="/#employers">Employers</a><a href="/#contact">Contact</a></nav></div></header>
<main class="wrap">${body}</main>
<footer><div class="wrap">© ${new Date().getFullYear()} J-Peace Recruiting LLC · Direct-hire recruiting based in Punxsutawney, PA · <a href="tel:+18148454341">(814) 845-4341</a> · <a href="/privacy-policy">Privacy Policy</a> · <a href="/terms-and-conditions">Terms</a></div></footer></body></html>`;
}

module.exports = { SITE, jobPostings, esc, page };
