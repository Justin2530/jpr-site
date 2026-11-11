import { requireStaff } from "@/lib/staff";
import { Empty, PageHeader, Stat } from "@/components/ui";
import { AGENTS, TEAMS } from "@/lib/agents";
import { AgentMap } from "./agent-map";

export const metadata = { title: "AI team · JPR" };

function dayAgo() {
  return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
}

export default async function AgentsPage() {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") {
    return (
      <>
        <PageHeader title="AI team" />
        <Empty>Only the owner can see the AI team.</Empty>
      </>
    );
  }
  const since = dayAgo();
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? null : (r.count ?? 0);
  };
  const head = { count: "exact" as const, head: true };
  // What each agent did in the last 24 hours, where its work leaves a clear trace. null = no counter for it yet.
  const [names, reception, messenger, screening, writeup, brain, relay, resume, registry] = await Promise.all([
    supabase.from("agent_names").select("key, name"),
    count(supabase.from("reception_calls").select("id", head).gte("created_at", since)),
    count(supabase.from("reception_calls").select("id", head).gte("cell_alerted_at", since)),
    count(supabase.from("screening_runs").select("id", head).eq("by_hand", false).gte("started_at", since)),
    count(supabase.from("screening_runs").select("id", head).not("summary", "is", null).gte("ended_at", since)),
    count(supabase.from("activities").select("id", head).gte("brain_claimed_at", since)),
    count(supabase.from("activities").select("id", head).gte("relay_claimed_at", since)),
    count(supabase.from("resumes").select("id", head).not("branded_from", "is", null).gte("created_at", since)),
    count(supabase.from("lead_registry").select("filing", head).gte("researched_at", since)),
  ]);
  const live: Record<string, number | null> = {
    reception,
    messenger,
    screening,
    call_watch: screening,
    writeup,
    brain,
    relay,
    resume,
    registry,
  };
  const nameMap = Object.fromEntries((names.data ?? []).map((r) => [r.key, r.name]));
  const usesAi = AGENTS.filter((a) => !/no AI decisions/i.test(a.brain)).length;
  const working = AGENTS.filter((a) => (live[a.key] ?? 0) > 0).length;
  const actions = Object.entries(live).reduce((s, [k, v]) => (k === "call_watch" ? s : s + (v ?? 0)), 0);

  return (
    <>
      <PageHeader kicker="Business" title="AI team" sub="Your agents, what each one does, and how work moves between them." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Team members" value={AGENTS.length} />
        <Stat label="Working (24h)" value={working} tone="mint" />
        <Stat label="Actions (24h)" value={actions.toLocaleString("en-US")} tone="amber" />
        <Stat label="AI agents · helpers" value={`${usesAi} · ${AGENTS.length - usesAi}`} tone="muted" />
      </div>
      <AgentMap agents={AGENTS} names={nameMap} live={live} teams={TEAMS} />
      <p className="mt-6 text-sm text-faint">JPR AI and the Job Board run in their own command centers, so their agents aren&apos;t listed here.</p>
    </>
  );
}
