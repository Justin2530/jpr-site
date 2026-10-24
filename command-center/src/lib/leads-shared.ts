import type { Enums } from "@/lib/database.types";

// Lead Engine pieces the browser can use too (labels, prices, the size guess). The worker is in leads.ts.
export type LeadLine = Enums<"lead_line">;

export const LINE_LABEL: Record<LeadLine, string> = { local: "JPR Local", usa: "JPR USA", ai: "JPR AI" };
export const LEAD_STATUS_LABEL: Record<Enums<"lead_status">, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  replied: "Replied",
  customer: "Customer",
  not_interested: "Not interested",
  do_not_contact: "Do not contact",
};

// Serper's price after the free 2,500: $50 buys 50,000 credits.
export const SERPER_FREE_CREDITS = 2500;
export const DOLLARS_PER_CREDIT = 0.001;
// Biggest single search allowed, so a slip of the mouse can't queue a nationwide run by accident.
export const MAX_TASKS_PER_SEARCH = 3500;

// The size guess, from what Google shows (see lead_size_score in the database).
export function sizeBand(score: number) {
  if (score >= 50) return { text: "Likely 5+", tone: "mint" as const };
  if (score >= 30) return { text: "Maybe 5+", tone: "amber" as const };
  return { text: "Likely small", tone: "muted" as const };
}

const STOP_WORDS = new Set(["llc", "inc", "incorporated", "co", "corp", "corporation", "company", "ltd", "limited", "the", "and", "of", "pc", "llp", "pllc"]);
// Same as lead_norm_name in the database: "ACME Machine & Welding Co, LLC" -> "acme machine welding".
export function normName(s: string | null | undefined) {
  return (s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ");
}

