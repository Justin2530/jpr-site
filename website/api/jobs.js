// /jobs: every open public job on one page, with keyword and location search.
// Server-rendered so the full list is indexable; the search filters the rendered cards in the browser.
const { SITE, jobPostings, esc, page } = require("./_shared");

// First real sentence(s) of a description for the card, skipping headings and bullet lines.
function snippet(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim())
    .filter((l) => l && !/^[•*\-]\s/.test(l) && l.length > 70 && /[.!?]$/.test(l));
  const s = lines[0] || "";
  return s.length > 180 ? s.slice(0, 177).replace(/\s+\S*$/, "").replace(/[,;:]$/, "") + "…" : s;
}

const town = (loc) => String(loc || "").split(",")[0].trim();

const CSS = `.intro{color:#5c5d61;margin:0 0 24px}.search{display:grid;grid-template-columns:1fr 240px;gap:12px;margin:0 0 10px}.search input,.search select{font:inherit;font-size:17px;padding:12px 14px;border:1px solid #c9c5be;border-radius:3px;background:#fff;color:#222328;min-height:52px;width:100%}.search input:focus,.search select:focus{outline:2px solid #b84520;outline-offset:1px}.count{font-size:15px;color:#6a6b70;margin:0 0 18px}.list{display:grid;gap:14px}.card{border:1px solid #e0dcd5;border-radius:4px;padding:18px 20px;display:flex;justify-content:space-between;gap:18px;align-items:center}.card h2{font-family:Manrope,sans-serif;font-size:21px;line-height:1.3;margin:0 0 4px}.card h2 a{text-decoration:none}.card h2 a:hover{text-decoration:underline}.card .where{font-size:16px;color:#5c5d61;margin:0}.card .snip{font-size:16px;margin:8px 0 0;color:#3a3b40}.card .button{margin:0;white-space:nowrap}.none{padding:22px;background:#f4f2ee;border-radius:4px}[hidden]{display:none!important}@media(max-width:640px){.search{grid-template-columns:1fr}.card{flex-direction:column;align-items:flex-start}}`;

module.exports = async (req, res) => {
  let jobs = [];
  try { jobs = await jobPostings(); } catch (e) { console.error(e); }
  const towns = [...new Set(jobs.map((j) => town(j.location)).filter(Boolean))].sort();
  const cards = jobs.map((j) => {
    const meta = [j.location, j.compensation, j.schedule].filter(Boolean).map(esc).join(" · ");
    const hay = [j.title, j.location, j.compensation, j.schedule, j.description].join(" ").toLowerCase();
    const snip = snippet(j.description);
    return `<article class="card" data-text="${esc(hay)}" data-town="${esc(town(j.location))}"><div><h2><a href="/jobs/${esc(j.id)}">${esc(j.title)}</a></h2><p class="where">${meta}</p>${snip ? `<p class="snip">${esc(snip)}</p>` : ""}</div><a class="button" href="/?apply=${esc(j.id)}#jobs">Apply</a></article>`;
  }).join("");
  const n = jobs.length;
  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "CollectionPage", name: "Current Openings", url: SITE + "/jobs",
      mainEntity: { "@type": "ItemList", numberOfItems: n,
        itemListElement: jobs.map((j, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/jobs/${j.id}`, name: j.title })) } },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Open Jobs", item: SITE + "/jobs" } ] } ] };
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(page({
    title: "Current Openings | JPR Direct-Hire Recruiting, Punxsutawney, PA",
    description: `Browse ${n ? n + " " : ""}current direct-hire openings through JPR in Punxsutawney, Jefferson County and the surrounding counties. Search by keyword or location and apply online.`,
    canonical: SITE + "/jobs", jsonld, css: CSS,
    body: `<p class="crumbs"><a href="/">Home</a> › Open Jobs</p><h1>Current Openings</h1>
<p class="intro">Direct-hire positions JPR is recruiting for right now. Don't see the right fit? <a href="/?apply=resume#jobs">Submit your resume</a> and we'll reach out when something lines up.</p>
${n ? `<form class="search" role="search" onsubmit="return false"><input id="q" type="search" aria-label="Search jobs" placeholder="Search by job title, skill or keyword" autocomplete="off"><select id="loc" aria-label="Location"><option value="">All locations</option>${towns.map((t) => `<option>${esc(t)}</option>`).join("")}</select></form>
<p class="count" id="count" aria-live="polite">${n} ${n === 1 ? "opening" : "openings"}</p>
<div class="list" id="list">${cards}</div><p class="none" id="none" hidden>No openings match that search. Try a different keyword or location, or <a href="/?apply=resume#jobs">send us your resume</a>.</p>`
      : `<p class="none">No openings are posted right now, but new searches open often. <a href="/?apply=resume#jobs">Send us your resume</a> and we'll reach out when something fits.</p>`}
<p class="note">These are direct-hire positions. JPR recruits for employers in Jefferson County and the surrounding counties. Questions? Call <a href="tel:+18148454341">(814) 845-4341</a>.</p>
<script>(function(){var q=document.getElementById("q");if(!q)return;var loc=document.getElementById("loc"),cards=[].slice.call(document.querySelectorAll(".card")),count=document.getElementById("count"),none=document.getElementById("none"),total=cards.length;
var p=new URLSearchParams(location.search);q.value=p.get("q")||"";if(p.get("location"))loc.value=p.get("location");
function run(){var words=q.value.toLowerCase().split(/\\s+/).filter(Boolean),t=loc.value,shown=0;cards.forEach(function(c){var ok=(!t||c.dataset.town===t)&&words.every(function(w){return c.dataset.text.indexOf(w)>-1});c.hidden=!ok;if(ok)shown++});
count.textContent=(shown===total?total:shown+" of "+total)+(total===1?" opening":" openings");none.hidden=shown>0;
var u=new URLSearchParams();if(q.value.trim())u.set("q",q.value.trim());if(t)u.set("location",t);history.replaceState(null,"",location.pathname+(u.toString()?"?"+u:""))}
q.addEventListener("input",run);loc.addEventListener("change",run);run()})();</script>`,
  }));
};
