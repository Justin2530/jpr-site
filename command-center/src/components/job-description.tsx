// A job description laid out like a document: short lines with no period become headings,
// "-" or "•" lines become bullets, everything else a paragraph.
type Block = { kind: "h" | "p"; text: string } | { kind: "ul"; items: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-•*·▪]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const last = out[out.length - 1];
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else out.push({ kind: "ul", items: [bullet[1]] });
    } else if (line.length <= 60 && !/[.,;]$/.test(line) && !line.includes(" • ") && !/:\s/.test(line)) {
      out.push({ kind: "h", text: line.replace(/:$/, "") });
    } else {
      out.push({ kind: "p", text: line });
    }
  }
  return out;
}

export function JobDescription({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-ink">
      {blocks(text).map((b, i) =>
        b.kind === "h" ? (
          <h2 key={i} className="pt-3 text-base font-semibold first:pt-0">
            {b.text}
          </h2>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-cyan">
            {b.items.map((t, j) => (
              <li key={j}>{t}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-muted">
            {b.text}
          </p>
        ),
      )}
    </div>
  );
}
