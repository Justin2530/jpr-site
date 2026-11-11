import { requireStaff } from "@/lib/staff";
import { Chip, Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { AGENTS, TEAMS } from "@/lib/agents";
import { renameAgent } from "./actions";

export const metadata = { title: "AI team · JPR" };

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
  const { data } = await supabase.from("agent_names").select("key, name");
  const names = new Map((data ?? []).map((r) => [r.key, r.name]));
  const usesAi = AGENTS.filter((a) => !/no AI decisions/i.test(a.brain)).length;

  return (
    <>
      <PageHeader
        kicker="Business"
        title="AI team"
        sub="Who does what in JPR Local. Click Rename on any card to give them your own name."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Team members" value={AGENTS.length} />
        <Stat label="AI agents" value={usesAi} tone="mint" />
        <Stat label="Helpers (no AI)" value={AGENTS.length - usesAi} tone="muted" />
        <Stat label="Teams" value={TEAMS.length} tone="amber" />
      </div>

      <div className="space-y-6">
        {TEAMS.map((team) => (
          <Panel key={team} title={team}>
            <div className="grid gap-4 lg:grid-cols-2">
              {AGENTS.filter((a) => a.team === team).map((a) => (
                <article key={a.key} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-ink">{names.get(a.key) ?? a.name}</h3>
                    <Chip tone="cyan">{a.title}</Chip>
                  </div>
                  <p className="mt-1 text-xs text-faint">{a.brain}</p>

                  <p className="panel-title mt-3">What they do</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                    {a.does.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>

                  <p className="panel-title mt-3">When</p>
                  <p className="mt-1 text-sm text-muted">{a.when}</p>

                  <p className="panel-title mt-3">Never</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                    {a.never.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    {a.seeIt && (
                      <a href={a.seeIt.href} className="link">
                        See their work: {a.seeIt.label}
                      </a>
                    )}
                    <details>
                      <summary className="cursor-pointer text-cyan">Rename</summary>
                      <form action={renameAgent} className="mt-2 flex gap-2">
                        <input type="hidden" name="key" value={a.key} />
                        <input name="name" required maxLength={40} defaultValue={names.get(a.key) ?? a.name} className="field" aria-label={`New name for the ${a.title}`} />
                        <SubmitButton>Save</SubmitButton>
                      </form>
                    </details>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        ))}
        <p className="text-sm text-faint">JPR AI and the Job Board run in their own command centers, so their agents aren&apos;t listed here.</p>
      </div>
    </>
  );
}
