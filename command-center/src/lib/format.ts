import type { Enums } from "@/lib/database.types";

export const STAGE_LABEL: Record<Enums<"pipeline_stage">, string> = {
  assigned: "Assigned",
  contacting: "Contacting",
  conversation: "In conversation",
  ready_to_submit: "Ready to submit",
  submitted: "Submitted",
  interviewing: "Interviewing",
  offer: "Offer",
  placed: "Placed",
  on_hold: "On hold",
  passed: "Passed",
  withdrawn: "Withdrawn",
};

export const STAGE_TONE: Record<Enums<"pipeline_stage">, Tone> = {
  assigned: "cyan",
  contacting: "cyan",
  conversation: "cyan",
  ready_to_submit: "amber",
  submitted: "amber",
  interviewing: "amber",
  offer: "mint",
  placed: "mint",
  on_hold: "muted",
  passed: "muted",
  withdrawn: "muted",
};

export const SOURCE_LABEL: Record<Enums<"candidate_source">, string> = {
  indeed: "Indeed",
  linkedin: "LinkedIn",
  website: "Website",
  referral: "Referral",
  database: "Database",
  direct_outreach: "Direct outreach",
  inbound: "Inbound call",
  other: "Other",
};

export type Tone = "cyan" | "amber" | "mint" | "rose" | "muted";

export function label(value: string) {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const future = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60000);
  let text: string;
  if (mins < 1) text = "just now";
  else if (mins < 60) text = `${mins}m`;
  else if (mins < 60 * 24) text = `${Math.round(mins / 60)}h`;
  else text = `${Math.round(mins / 1440)}d`;
  if (text === "just now") return text;
  return future ? `in ${text}` : `${text} ago`;
}

export function shortDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Empty form fields become null so optional columns stay empty rather than "".
export function text(form: FormData, key: string) {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function num(form: FormData, key: string) {
  const t = text(form, key);
  if (t === null) return null;
  const n = Number(t.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
