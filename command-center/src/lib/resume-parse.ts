import { strFromU8, unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";

export type ParsedResume = {
  full_name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  current_title: string;
  current_employer: string;
  linkedin_url: string;
  notes: string;
};

const EMPTY: ParsedResume = {
  full_name: "",
  phone: "",
  email: "",
  city: "",
  state: "",
  current_title: "",
  current_employer: "",
  linkedin_url: "",
  notes: "",
};

// Plain text out of a PDF, Word (.docx) or text resume. Older .doc files aren't readable here.
export async function resumeText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/[ \t]+\n/g, "\n").trim();
  }
  if (name.endsWith(".docx")) {
    const files = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
    const xml = strFromU8(files["word/document.xml"] ?? new Uint8Array());
    return xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>|<w:br\/>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  if (name.endsWith(".txt") || name.endsWith(".rtf") || file.type.startsWith("text/")) {
    return new TextDecoder().decode(buf).replace(/\{\\[^}]*\}|\\[a-z]+\d* ?/g, "").trim();
  }
  return "";
}

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(STATES));

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// Contact details by pattern. Good for name, email, phone, LinkedIn and city; the AI pass does the rest.
export function parseByPattern(text: string): ParsedResume {
  const out = { ...EMPTY };
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  out.email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]?.toLowerCase() ?? "";
  const phone = text.match(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  if (phone) out.phone = `(${phone[1]}) ${phone[2]}-${phone[3]}`;
  const li = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/i)?.[0];
  if (li) out.linkedin_url = li.startsWith("http") ? li : `https://${li}`;

  const nameLine = lines
    .slice(0, 8)
    .find((l) => /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,3}$/.test(l) && !/resume|curriculum|vitae|objective|summary/i.test(l));
  if (nameLine) out.full_name = nameLine === nameLine.toUpperCase() ? titleCase(nameLine) : nameLine;

  // "City, ST" or "City, State": the city is whatever sits between the previous comma or bar and the state.
  find: for (const l of lines.slice(0, 20)) {
    for (const m of l.matchAll(/,\s*([A-Za-z]{2}|[A-Za-z]+(?: [A-Za-z]+)?)\b(?:\s+\d{5}(?:-\d{4})?)?/g)) {
      const raw = m[1];
      const code = raw.length === 2 ? (CODES.has(raw.toUpperCase()) && raw === raw.toUpperCase() ? raw : null) : STATES[raw.toLowerCase()];
      if (!code) continue;
      const city = l.slice(0, m.index).split(/[,|•·]/).pop()?.trim() ?? "";
      if (!/^[A-Za-z][A-Za-z .'-]{1,30}$/.test(city)) continue;
      out.city = city;
      out.state = code;
      break find;
    }
  }
  return out;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(Object.keys(EMPTY).map((k) => [k, { type: "string" }])),
  required: Object.keys(EMPTY),
};

// The AI pass: reads the whole resume and fills every field, including current job and a short summary.
// Only runs when the OpenAI key is in Vercel; otherwise the pattern pass stands on its own.
export async function parseWithAI(text: string): Promise<ParsedResume | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !text) return null;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      instructions:
        "You read resumes for a recruiting firm and pull out the candidate's details. Use only what the resume says; leave a field as an empty string when it isn't there. " +
        "phone: formatted (814) 555-1234. state: two-letter US code. current_title and current_employer: their most recent job. " +
        "notes: 2-3 short plain sentences for a recruiter: years of experience, main skills, machines, certifications, and anything notable.",
      input: text.slice(0, 30000),
      text: { format: { type: "json_schema", name: "resume", schema: SCHEMA, strict: true } },
    }),
  });
  if (!res.ok) {
    console.error("Resume AI failed", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const data = await res.json();
  const out = (data.output ?? [])
    .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
    .find((c: { type: string }) => c.type === "output_text")?.text;
  try {
    return { ...EMPTY, ...JSON.parse(out) };
  } catch {
    return null;
  }
}

export function aiReady() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

// Both passes together: the AI's answer wins where it has one, the patterns fill any gaps.
export async function parseResume(text: string): Promise<ParsedResume> {
  const base = parseByPattern(text);
  let ai: ParsedResume | null = null;
  try {
    ai = await parseWithAI(text);
  } catch (e) {
    console.error("Resume AI failed", e);
  }
  if (!ai) return base;
  const merged = { ...base };
  for (const k of Object.keys(EMPTY) as (keyof ParsedResume)[]) if (ai[k]?.trim()) merged[k] = ai[k].trim();
  return merged;
}
