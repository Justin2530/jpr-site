// Builds the public site's blog from blog-src/*.md into website/blog/ (static HTML, no build step on Vercel).
// Run: node scripts/build-blog.js   Post file format: front matter (title, description, date, slug), then
// a body where "## " starts a heading, "- " lines make a list and blank lines separate paragraphs.
// Posts dated in the future are skipped, so a post can be written ahead and go up on its date.
const fs = require("fs"), path = require("path");
const { SITE, esc, page } = require("../website/api/_shared");

const SRC = path.join(__dirname, "../blog-src"), OUT = path.join(__dirname, "../website/blog");
const today = new Date().toISOString().slice(0, 10);

function parse(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/\r/g, "");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("missing front matter: " + file);
  const meta = Object.fromEntries(m[1].split("\n").map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  return { ...meta, body: m[2].trim() };
}

// **bold** and [text](url) inside a line; everything else escaped.
const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');

function render(body) {
  return body.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines[0].startsWith("## ")) return `<h2>${inline(lines[0].slice(3))}</h2>` + (lines.length > 1 ? render(lines.slice(1).join("\n")) : "");
    if (lines.every((l) => l.startsWith("- "))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
    return `<p>${inline(lines.join(" "))}</p>`;
  }).join("");
}

const nice = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const CSS = `.post p,.post li{max-width:70ch}.post h2{font-family:Manrope,sans-serif;font-size:26px;letter-spacing:-.01em;line-height:1.25;margin:36px 0 10px}.post ul{padding-left:22px}.post li{margin:0 0 8px}.post a{color:#b84520}.date{color:#6a6b70;font-size:16px;margin:0 0 28px}.cta{background:#f4f2ee;border:1px solid #e6e2dc;border-radius:4px;padding:22px 24px;margin:40px 0 0}.cta h2{margin:0 0 8px!important;font-size:22px!important}.cta p{margin:0 0 14px}.cta .button{margin:4px 14px 0 0}.posts{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:14px}.posts li{border:1px solid #e0dcd5;border-radius:4px;padding:18px 20px}.posts h2{font-family:Manrope,sans-serif;font-size:22px;line-height:1.3;margin:0 0 4px}.posts h2 a{text-decoration:none}.posts h2 a:hover{text-decoration:underline}.posts p{margin:6px 0 0;font-size:17px;color:#3a3b40}.posts .date{margin:0;font-size:15px}`;
const CTA = `<div class="cta"><h2>Hiring in Jefferson County or the surrounding area?</h2><p>JPR finds, recruits and screens people for direct-hire positions, so you only spend time on candidates worth meeting.</p><a class="button" href="/#contact">Tell us what you're hiring for</a><a href="/jobs">Looking for a job? See current openings</a></div>`;
const ORG = { "@type": "Organization", "@id": SITE + "/#business", name: "JPR", url: SITE + "/" };

const posts = fs.readdirSync(SRC).filter((f) => f.endsWith(".md")).map((f) => parse(path.join(SRC, f)))
  .filter((p) => p.date <= today).sort((a, b) => b.date.localeCompare(a.date));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const p of posts) {
  const url = `${SITE}/blog/${p.slug}`;
  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "BlogPosting", headline: p.title, description: p.description, datePublished: p.date, dateModified: p.updated || p.date,
      author: ORG, publisher: ORG, mainEntityOfPage: url, image: SITE + "/img/og.jpg" },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: SITE + "/blog" },
      { "@type": "ListItem", position: 3, name: p.title, item: url } ] } ] };
  fs.writeFileSync(path.join(OUT, p.slug + ".html"), page({ title: `${p.title} | JPR`, description: p.description, canonical: url, jsonld, css: CSS,
    body: `<p class="crumbs"><a href="/">Home</a> › <a href="/blog">Blog</a></p><article class="post"><h1>${esc(p.title)}</h1><p class="date">${nice(p.date)} · JPR</p>${render(p.body)}</article>${CTA}` }));
}
fs.writeFileSync(path.join(OUT, "index.html"), page({ title: "Hiring Insights for Employers | JPR Blog", description: "Practical hiring advice for employers in Punxsutawney, Jefferson County and the surrounding counties, from JPR, a direct-hire recruiter.",
  canonical: SITE + "/blog", css: CSS,
  body: `<p class="crumbs"><a href="/">Home</a> › Blog</p><h1>Hiring Insights</h1><p class="date">Practical advice on finding and hiring the right people, from JPR.</p><ul class="posts">${posts.map((p) => `<li><h2><a href="/blog/${p.slug}">${esc(p.title)}</a></h2><p class="date">${nice(p.date)}</p><p>${esc(p.description)}</p></li>`).join("")}</ul>${CTA}` }));
fs.writeFileSync(path.join(OUT, "posts.json"), JSON.stringify(posts.map((p) => ({ slug: p.slug, date: p.updated || p.date }))));
console.log(`built ${posts.length} post(s)`);
