// /jobs/:id — one open job as its own page, with JobPosting structured data so Google can list it.
const { SITE, jobPostings, esc } = require("./_shared");

const ORG = {
  "@type": "EmploymentAgency",
  "@id": SITE + "/#business",
  name: "JPR",
  legalName: "J-Peace Recruiting LLC",
  url: SITE + "/",
  logo: SITE + "/img/logo.webp",
};

function place(location) {
  const parts = String(location || "Punxsutawney, PA").split(",").map((s) => s.trim()).filter(Boolean);
  const region = (parts[1] || "PA").replace(/\s+\d{5}.*$/, "");
  return { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: parts[0], addressRegion: region, addressCountry: "US" } };
}

// Plain-text description -> HTML. Blank lines separate blocks; "• " / "* " / "- " lines become a list;
// a short first line with no closing punctuation, followed by more lines, becomes a heading.
function formatDescription(text) {
  const BULLET = /^\s*[•*\-]\s+/;
  return String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    let html = "", list = [];
    const flush = () => { if (list.length) { html += `<ul>${list.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`; list = []; } };
    lines.forEach((line, i) => {
      if (BULLET.test(line)) { list.push(line.replace(BULLET, "")); return; }
      flush();
      if (i === 0 && lines.length > 1 && line.length <= 70 && !/[.:!?,;]$/.test(line)) html += `<h2>${esc(line)}</h2>`;
      else html += `<p>${esc(line)}</p>`;
    });
    flush();
    return html;
  }).join("");
}

function page({ title, description, canonical, body, jsonld, status }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">${canonical ? `<link rel="canonical" href="${canonical}">` : `<meta name="robots" content="noindex">`}
<link rel="icon" href="/img/logo-sm.webp"><meta property="og:type" content="website"><meta property="og:site_name" content="JPR"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${canonical ? `<meta property="og:url" content="${canonical}">` : ""}<meta property="og:image" content="${SITE}/img/og.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;color:#222328;background:#fff;font-family:'Source Sans 3',sans-serif;font-size:19px;line-height:1.65}a{color:inherit}.wrap{max-width:860px;margin:auto;padding:0 22px}header{border-bottom:1px solid #e6e2dc}header .wrap{display:flex;align-items:center;justify-content:space-between;min-height:84px;gap:16px}header img{width:100px;height:74px;object-fit:contain}nav a{font-weight:600;font-size:16px;margin-left:20px;text-decoration:none}.crumbs{font-size:14px;color:#6a6b70;margin:28px 0 8px}.crumbs a{text-decoration:underline}h1{font-family:Manrope,sans-serif;font-size:clamp(34px,5vw,52px);letter-spacing:-.03em;line-height:1.1;margin:0 0 12px}.meta{color:#5c5d61;font-size:18px;margin-bottom:28px}.desc p{margin:0 0 16px}.desc h2{font-family:Manrope,sans-serif;font-size:24px;letter-spacing:-.01em;line-height:1.25;margin:32px 0 10px}.desc ul{margin:0 0 18px;padding-left:22px}.desc li{margin:0 0 6px}.button{display:inline-flex;align-items:center;justify-content:center;padding:16px 26px;min-height:54px;font-size:18px;background:#b84520;color:#fff;font-weight:600;border-radius:3px;text-decoration:none;margin:12px 16px 12px 0}.button:hover{background:#903617}.note{background:#f4f2ee;border:1px solid #e6e2dc;padding:18px 20px;border-radius:4px;font-size:17px;margin:32px 0}footer{background:#f2f0ec;border-top:1px solid #ddd9d2;padding:28px 0;font-size:14px;color:#555;margin-top:48px}@media(max-width:600px){nav{display:none}}</style>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><header><div class="wrap"><a href="/"><img src="/img/logo-sm.webp" width="248" height="183" alt="JPR Recruitment Services"></a><nav aria-label="Main navigation"><a href="/#jobs">Open Jobs</a><a href="/#employers">Employers</a><a href="/#contact">Contact</a></nav></div></header>
<main class="wrap">${body}</main>
<footer><div class="wrap">© ${new Date().getFullYear()} J-Peace Recruiting LLC · Direct-hire recruiting based in Punxsutawney, PA · <a href="tel:+18148454341">(814) 845-4341</a> · <a href="/privacy-policy">Privacy Policy</a> · <a href="/terms-and-conditions">Terms</a></div></footer></body></html>`;
}

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  let job = null;
  try { job = (await jobPostings()).find((j) => j.id === id) || null; } catch (e) { console.error(e); }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!job) {
    res.setHeader("Cache-Control", "public, s-maxage=300");
    return res.status(404).send(page({
      title: "This job is no longer open | JPR",
      description: "This position has been filled or closed. See current openings with JPR.",
      body: `<p class="crumbs"><a href="/">Home</a> › <a href="/#jobs">Open Jobs</a></p><h1>This job is no longer open</h1><p>The position you're looking for has been filled or closed. New searches open often.</p><a class="button" href="/#jobs">See current openings</a>`,
    }));
  }
  const url = `${SITE}/jobs/${job.id}`;
  const meta = [job.location, job.compensation, job.schedule].filter(Boolean);
  const descHtml = formatDescription(job.description);
  const posted = String(job.opened_on).slice(0, 10);
  const valid = new Date(new Date(posted).getTime() + 90 * 864e5).toISOString().slice(0, 10);
  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "JobPosting", title: job.title, description: descHtml || esc(job.title), datePosted: posted, validThrough: valid,
      employmentType: /part/i.test(job.schedule || "") ? "PART_TIME" : "FULL_TIME",
      hiringOrganization: ORG, jobLocation: place(job.location), directApply: true, url, identifier: { "@type": "PropertyValue", name: "JPR", value: job.id } },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Open Jobs", item: SITE + "/#jobs" },
      { "@type": "ListItem", position: 3, name: job.title, item: url } ] } ] };
  const where = job.location ? ` in ${job.location}` : "";
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(page({
    title: `${job.title}${where} | JPR`,
    description: `${job.title}${where}. ${meta.slice(1).join(" · ")}${meta.length > 1 ? ". " : ""}Direct-hire position through JPR, a recruiter based in Punxsutawney, PA.`.slice(0, 300),
    canonical: url, jsonld,
    body: `<p class="crumbs"><a href="/">Home</a> › <a href="/#jobs">Open Jobs</a></p><h1>${esc(job.title)}</h1><p class="meta">${meta.map(esc).join(" · ")}</p>
<div class="desc">${descHtml || "<p>Contact JPR for full details on this position.</p>"}</div>
<a class="button" href="/?apply=${esc(job.id)}#jobs">Apply for this job</a><a href="/#jobs">See all openings</a>
<p class="note">This is a direct-hire position. JPR recruits for employers in Jefferson County and the surrounding counties. Questions? Call <a href="tel:+18148454341">(814) 845-4341</a>.</p>`,
  }));
};
