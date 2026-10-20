// /jobs/:id — one open job as its own page, with JobPosting structured data so Google can list it.
const { SITE, jobPostings, esc, page } = require("./_shared");

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
      body: `<p class="crumbs"><a href="/">Home</a> › <a href="/jobs">Open Jobs</a></p><h1>This job is no longer open</h1><p>The position you're looking for has been filled or closed. New searches open often.</p><a class="button" href="/jobs">See current openings</a>`,
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
      { "@type": "ListItem", position: 2, name: "Open Jobs", item: SITE + "/jobs" },
      { "@type": "ListItem", position: 3, name: job.title, item: url } ] } ] };
  const where = job.location ? ` in ${job.location}` : "";
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(page({
    title: `${job.title}${where} | JPR`,
    description: `${job.title}${where}. ${meta.slice(1).join(" · ")}${meta.length > 1 ? ". " : ""}Direct-hire position through JPR, a recruiter based in Punxsutawney, PA.`.slice(0, 300),
    canonical: url, jsonld,
    body: `<p class="crumbs"><a href="/">Home</a> › <a href="/jobs">Open Jobs</a></p><h1>${esc(job.title)}</h1><p class="meta">${meta.map(esc).join(" · ")}</p>
<div class="desc">${descHtml || "<p>Contact JPR for full details on this position.</p>"}</div>
<a class="button" href="/?apply=${esc(job.id)}#jobs">Apply for this job</a><a href="/jobs">See all openings</a>
<p class="note">This is a direct-hire position. JPR recruits for employers in Jefferson County and the surrounding counties. Questions? Call <a href="tel:+18148454341">(814) 845-4341</a>.</p>`,
  }));
};
