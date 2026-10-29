// A website hiring request as the form saved it (site_hiring_request): title "Hiring request: Name at Company",
// detail lines "Position: …", "Location: …", "Email: …", "Phone: … (OK to text)", then their message.
export function parseHiringRequest(title: string | null, detail: string | null) {
  const head = (title ?? "").replace(/^Hiring request:\s*/i, "");
  const at = head.indexOf(" at ");
  const name = (at < 0 ? head : head.slice(0, at)).trim();
  const company = at < 0 ? null : head.slice(at + 4).trim() || null;
  const out = { name, company, position: null as string | null, location: null as string | null, email: null as string | null, phone: null as string | null, smsOk: false, nationwide: false, message: "" };
  const rest: string[] = [];
  for (const raw of (detail ?? "").split("\n")) {
    const line = raw.trim();
    const m = line.match(/^(Position|Location|Email|Phone):\s*(.*)$/i);
    if (m) {
      const v = m[2].trim();
      const key = m[1].toLowerCase();
      if (key === "position") out.position = v || null;
      if (key === "location") out.location = v || null;
      if (key === "email") out.email = v || null;
      if (key === "phone") {
        out.smsOk = /ok to text/i.test(v);
        out.phone = v.replace(/\s*\(ok to text\)\s*/i, "").trim() || null;
      }
      continue;
    }
    let text = line;
    if (/^\[From the nationwide manufacturing page\]/i.test(text)) {
      out.nationwide = true;
      text = text.replace(/^\[From the nationwide manufacturing page\]\s*/i, "");
    }
    if (text) rest.push(text);
  }
  out.message = rest.join("\n");
  return out;
}
