"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff";
import { text } from "@/lib/format";
import { COUNTIES_BY_STATE } from "@/lib/counties";
import { LINE_LABEL, MAX_TASKS_PER_SEARCH } from "@/lib/leads-shared";
import type { Enums } from "@/lib/database.types";

async function owner() {
  const ctx = await requireStaff();
  if (ctx.staff.role !== "owner") throw new Error("Only the owner can use the Lead Engine.");
  return ctx;
}

const LINES = ["local", "usa", "ai"] as const;
const STATUSES = ["prospect", "contacted", "replied", "customer", "not_interested", "do_not_contact"] as const;

// Queue a search: one Google Maps lookup per county x keyword (more pages only while they keep finding
// new businesses). The worker picks it up within 2 minutes.
export async function startSearch(form: FormData) {
  const { supabase, userId } = await owner();
  const line = text(form, "line") as Enums<"lead_line">;
  if (!LINES.includes(line)) throw new Error("Pick JPR Local, JPR USA or JPR AI.");
  const keywords = [
    ...new Set(
      (text(form, "keywords") ?? "")
        .split(/[\n,]+/)
        .map((k) => k.trim().replace(/\s+/g, " "))
        .filter((k) => k.length >= 2 && k.length <= 80),
    ),
  ];
  if (!keywords.length) throw new Error("Add at least one keyword.");
  const areas: { state: string; county: string }[] = [];
  for (const v of form.getAll("area")) {
    const [state, county] = String(v).split("|");
    if (COUNTIES_BY_STATE[state]?.includes(county) && !areas.some((a) => a.state === state && a.county === county)) areas.push({ state, county });
  }
  if (!areas.length) throw new Error("Pick at least one county.");
  const pages = Math.min(3, Math.max(1, Number(text(form, "pages") ?? 2) || 2));
  // WellThree's "stop after finding this many businesses" (blank = cover everything picked).
  const target = Math.floor(Number(text(form, "target") ?? "") || 0) || null;
  const tasks = keywords.length * areas.length;
  if (tasks > MAX_TASKS_PER_SEARCH)
    throw new Error(`That's ${tasks.toLocaleString()} searches. Keep one run under ${MAX_TASKS_PER_SEARCH.toLocaleString()} (fewer keywords or counties).`);

  const states = [...new Set(areas.map((a) => a.state))];
  const name =
    text(form, "name") ??
    `${LINE_LABEL[line]}: ${keywords.length === 1 ? keywords[0] : `${keywords.length} keywords`} in ${
      areas.length === 1 ? `${areas[0].county}, ${areas[0].state}` : `${areas.length} counties (${states.join(", ")})`
    }`;
  const { data: search, error } = await supabase
    .from("lead_searches")
    .insert({ line, name, keywords, areas, max_pages: pages, task_count: tasks, max_credits: tasks * pages, target_count: target && target > 0 ? target : null, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const rows = areas.flatMap((a) => keywords.map((keyword) => ({ search_id: search.id, state: a.state, county: a.county, keyword })));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await supabase.from("lead_search_tasks").insert(rows.slice(i, i + 500));
    if (e) {
      // Don't leave half a search behind.
      await supabase.from("lead_searches").update({ status: "canceled", error: `Couldn't queue: ${e.message}`, finished_at: new Date().toISOString() }).eq("id", search.id);
      throw new Error(e.message);
    }
  }
  redirect(`/leads?line=${line}`);
}

export async function setSearchStatus(form: FormData) {
  const { supabase } = await owner();
  const id = text(form, "id")!;
  const to = text(form, "to");
  const { data: s } = await supabase.from("lead_searches").select("status").eq("id", id).single();
  if (!s) throw new Error("Search not found.");
  if (to === "pause" && ["queued", "running"].includes(s.status)) {
    await supabase.from("lead_searches").update({ status: "paused" }).eq("id", id);
  } else if (to === "resume" && s.status === "paused") {
    const { count } = await supabase.from("lead_search_tasks").select("id", { count: "exact", head: true }).eq("search_id", id).in("status", ["queued", "running"]);
    await supabase
      .from("lead_searches")
      .update(count ? { status: "running", error: null } : { status: "done", finished_at: new Date().toISOString() })
      .eq("id", id);
  } else if (to === "cancel" && ["queued", "running", "paused"].includes(s.status)) {
    await supabase.from("lead_searches").update({ status: "canceled", finished_at: new Date().toISOString() }).eq("id", id);
    await supabase.from("lead_search_tasks").update({ status: "canceled" }).eq("search_id", id).eq("status", "queued");
  }
  revalidatePath("/leads");
}

// A lead's status on one line. "Do not contact" holds on every line: someone who asked not to hear from
// JPR doesn't hear from JPR USA or JPR AI either.
export async function setLeadStatus(form: FormData) {
  const { supabase } = await owner();
  const business = text(form, "business")!;
  const line = text(form, "line") as Enums<"lead_line">;
  const status = text(form, "status") as Enums<"lead_status">;
  if (!LINES.includes(line) || !STATUSES.includes(status)) throw new Error("Unknown status.");
  const now = new Date().toISOString();
  const q = supabase.from("lead_list_members").update({ status, status_changed_at: now }).eq("business_id", business);
  const { error } = status === "do_not_contact" ? await q : await q.eq("line", line);
  if (error) throw new Error(error.message);
  revalidatePath("/leads");
}

// A JPR Local lead that's real now: add it to Companies as a prospect (with the owner as a contact), linked
// both ways so it's one record. JPR USA and JPR AI leads stay out of Companies (USA gets its own market when
// the first nationwide client signs; JPR AI keeps its own system).
export async function addToCompanies(form: FormData) {
  const { supabase, userId, markets } = await owner();
  const id = text(form, "business")!;
  const { data: b, error } = await supabase.from("lead_businesses").select("*, lead_list_members(line)").eq("id", id).single();
  if (error || !b) throw new Error(error?.message ?? "Lead not found.");
  if (b.company_id) redirect(`/companies/${b.company_id}`);
  if (!b.lead_list_members.some((m) => m.line === "local")) throw new Error("Only JPR Local leads go into Companies.");
  const market = markets.find((m) => m.slug === "punxsutawney") ?? markets[0];
  const { data: c, error: e1 } = await supabase
    .from("companies")
    .insert({
      market_id: market.id,
      name: b.name,
      status: "prospect",
      industry: b.category,
      website: b.website,
      phone: b.phone,
      city: b.city,
      notes: [
        `From the Lead Engine (${[b.county, b.state].filter(Boolean).join(", ")}).`,
        b.address,
        !b.owner_name && b.primary_email ? `Email: ${b.primary_email}` : null,
      ]
        .filter(Boolean)
        .join(" "),
      created_by: userId,
    })
    .select("id")
    .single();
  if (e1) throw new Error(e1.message);
  if (b.owner_name) {
    await supabase.from("contacts").insert({ company_id: c.id, full_name: b.owner_name, title: b.owner_title, email: b.primary_email, phone: b.phone });
  }
  await supabase.from("lead_businesses").update({ company_id: c.id }).eq("id", id);
  redirect(`/companies/${c.id}`);
}
