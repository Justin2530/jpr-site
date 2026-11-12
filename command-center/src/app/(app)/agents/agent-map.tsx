"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { Agent } from "@/lib/agents";
import { renameAgent } from "./actions";

// The AI team as a live network: Justin in the middle, Jarvis (his chief of staff) as a ring around him, between him
// and the team (Justin 2026-11-12), each agent on the outer ring, links for the hand-offs between agents. Active agents (did something in the last 24 hours) pulse. Click a node for its full card.

const TEAM_COLOR: Record<Agent["team"], string> = {
  "Front desk": "var(--c-rose)",
  "Inbox & messages": "var(--c-mint)",
  Recruiting: "var(--c-cyan)",
  Clients: "var(--c-amber)",
  Sales: "var(--c-ink)",
};

type Live = Record<string, number | null>;
type Props = { agents: Agent[]; names: Record<string, string>; live: Live; teams: Agent["team"][] };

const W = 1000;
const H = 640;
const CX = W / 2;
const CY = H / 2;
const CENTER = "jarvis";

export function AgentMap({ agents, names, live, teams }: Props) {
  const byTeam = teams.flatMap((t) => agents.filter((a) => a.team === t));
  const chief = byTeam.find((a) => a.key === CENTER);
  const ring = byTeam.filter((a) => a.key !== CENTER);
  const ordered = chief ? [chief, ...ring] : ring;
  const [selected, setSelected] = useState<string>(chief?.key ?? ring.find((a) => (live[a.key] ?? 0) > 0)?.key ?? ring[0].key);
  const [hover, setHover] = useState<string | null>(null);

  const pos = new Map(
    ring.map((a, i) => {
      const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
      return [a.key, { x: CX + Math.cos(angle) * 390, y: CY + Math.sin(angle) * 240 }];
    }),
  );
  pos.set(CENTER, { x: CX, y: CY });
  const focus = hover ?? selected;
  // Jarvis directs the whole team, so focusing him lights every spoke.
  const linked = new Set<string>(focus === CENTER ? ordered.map((a) => a.key) : [focus]);
  for (const a of ordered) {
    if (a.key === focus) a.feeds?.forEach((f) => linked.add(f));
    if (a.feeds?.includes(focus)) linked.add(a.key);
  }
  const sel = ordered.find((a) => a.key === selected)!;
  const name = (a: Agent) => names[a.key] ?? a.name;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">
      <section className="panel relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="panel-title">Agent network</h2>
          <div className="flex flex-wrap gap-3">
            {teams.map((t) => (
              <span key={t} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: TEAM_COLOR[t], boxShadow: `0 0 8px ${TEAM_COLOR[t]}` }} />
                {t}
              </span>
            ))}
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="agent-map block h-auto w-full" role="img" aria-label="Map of the AI team and how work passes between them">
          <defs>
            <radialGradient id="core-glow">
              <stop offset="0%" stopColor="var(--c-cyan)" stopOpacity="0.55" />
              <stop offset="60%" stopColor="var(--c-cyan)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--c-cyan)" stopOpacity="0" />
            </radialGradient>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="var(--c-line)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#grid)" opacity="0.5" />

          {/* rings */}
          <ellipse cx={CX} cy={CY} rx={390} ry={240} fill="none" stroke="var(--c-line-strong)" strokeDasharray="2 8" />
          <ellipse cx={CX} cy={CY} rx={200} ry={124} fill="none" stroke="var(--c-line)" className="map-spin" />
          {!chief && (
            <ellipse cx={CX} cy={CY} rx={120} ry={74} fill="none" stroke="var(--c-line-strong)" strokeDasharray="10 14" className="map-spin-rev" />
          )}

          {/* spokes from the core (Jarvis) to every agent */}
          {ring.map((a) => {
            const p = pos.get(a.key)!;
            const on = linked.has(a.key);
            return (
              <line
                key={`s-${a.key}`}
                x1={CX}
                y1={CY}
                x2={p.x}
                y2={p.y}
                stroke={TEAM_COLOR[a.team]}
                strokeOpacity={on ? 0.55 : 0.14}
                strokeWidth={on ? 1.6 : 1}
                strokeDasharray="4 6"
                className="map-flow"
              />
            );
          })}

          {/* hand-offs between agents */}
          {ring.flatMap((a) =>
            (a.feeds ?? []).map((f) => {
              const p1 = pos.get(a.key)!;
              const p2 = pos.get(f);
              if (!p2) return null;
              const mx = (p1.x + p2.x) / 2;
              const my = (p1.y + p2.y) / 2;
              // bow each link toward the core so it reads as a path through the team
              const d = `M${p1.x},${p1.y} Q${mx + (CX - mx) * 0.45},${my + (CY - my) * 0.45} ${p2.x},${p2.y}`;
              const on = linked.has(a.key) && linked.has(f) && (a.key === focus || f === focus);
              const id = `h-${a.key}-${f}`;
              return (
                <g key={id}>
                  <path id={id} d={d} fill="none" stroke={TEAM_COLOR[a.team]} strokeOpacity={on ? 0.9 : 0.3} strokeWidth={on ? 2.4 : 1.4} />
                  <circle r={on ? 4 : 3} fill={TEAM_COLOR[a.team]} className="map-packet">
                    <animateMotion dur={on ? "1.8s" : "3.6s"} repeatCount="indefinite">
                      <mpath href={`#${id}`} />
                    </animateMotion>
                  </circle>
                </g>
              );
            }),
          )}

          {/* core */}
          <circle cx={CX} cy={CY} r={110} fill="url(#core-glow)" />

          {/* Jarvis: the ring between Justin and the team */}
          {chief && (
            <g
              className="cursor-pointer outline-none"
              tabIndex={0}
              role="button"
              aria-label={`${name(chief)}, ${chief.title}`}
              onClick={() => setSelected(CENTER)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(CENTER)}
              onMouseEnter={() => setHover(CENTER)}
              onMouseLeave={() => setHover(null)}
            >
              <ellipse cx={CX} cy={CY} rx={118} ry={82} fill="none" stroke="var(--c-cyan)" strokeOpacity={selected === CENTER ? 0.3 : 0.16} strokeWidth="16" />
              <ellipse
                cx={CX}
                cy={CY}
                rx={118}
                ry={82}
                fill="none"
                stroke="var(--c-cyan)"
                strokeWidth={selected === CENTER ? 2.5 : 1.6}
                strokeDasharray="10 8"
                className="map-spin-rev"
                style={{ filter: "drop-shadow(0 0 8px var(--c-cyan))" }}
              />
              {(live[CENTER] ?? 0) > 0 && <ellipse cx={CX} cy={CY} rx={128} ry={92} fill="none" stroke="var(--c-cyan)" strokeWidth="1.5" className="map-pulse" />}
              <rect x={CX - 52} y={CY - 82 - 11} width={104} height={22} rx={11} fill="var(--c-panel-solid)" stroke="var(--c-cyan)" strokeWidth="1.5" />
              <text x={CX} y={CY - 82 + 5} textAnchor="middle" fontSize="13" fontWeight="700" letterSpacing="2" className="font-mono" style={{ fill: "var(--c-cyan)" }}>
                {name(chief).toUpperCase()}
              </text>
              <text x={CX} y={CY + 82 + 20} textAnchor="middle" fontSize="10" letterSpacing="1.5" className="fill-muted font-mono">
                {chief.title.toUpperCase()}
              </text>
            </g>
          )}

          {/* core: Justin */}
          <circle cx={CX} cy={CY} r={46} fill="var(--c-panel-solid)" stroke="var(--c-cyan)" strokeWidth="2" className="map-core" />
          <text x={CX} y={CY - 2} textAnchor="middle" className="fill-ink font-mono" fontSize="20" fontWeight="700">
            JPR
          </text>
          <text x={CX} y={CY + 16} textAnchor="middle" className="fill-muted font-mono" fontSize="9" letterSpacing="2">
            JUSTIN
          </text>

          {/* agents */}
          {ring.map((a) => {
            const p = pos.get(a.key)!;
            const c = TEAM_COLOR[a.team];
            const active = (live[a.key] ?? 0) > 0;
            const isSel = a.key === selected;
            const dim = !linked.has(a.key);
            return (
              <g
                key={a.key}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer outline-none"
                opacity={dim ? 0.55 : 1}
                tabIndex={0}
                role="button"
                aria-label={`${name(a)}, ${a.title}`}
                onClick={() => setSelected(a.key)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(a.key)}
                onMouseEnter={() => setHover(a.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(a.key)}
                onBlur={() => setHover(null)}
              >
                {active && <circle r={30} fill="none" stroke={c} strokeWidth="2" className="map-pulse" />}
                {isSel && <circle r={36} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="3 5" className="map-spin" />}
                <circle r={26} fill="var(--c-panel-solid)" stroke={c} strokeWidth={isSel ? 3 : 2} style={{ filter: `drop-shadow(0 0 ${isSel ? 14 : 7}px ${c})` }} />
                <text y={7} textAnchor="middle" fontSize="20" fontWeight="700" style={{ fill: c }} className="font-mono">
                  {name(a).slice(0, 1).toUpperCase()}
                </text>
                <circle cx={19} cy={-19} r={5} fill={active ? "var(--c-mint)" : "var(--c-faint)"} stroke="var(--c-panel-solid)" strokeWidth="2" />
                <text y={46} textAnchor="middle" fontSize="15" fontWeight="600" className="fill-ink">
                  {name(a)}
                </text>
                <text y={62} textAnchor="middle" fontSize="10.5" letterSpacing="1" className="fill-muted font-mono">
                  {a.title.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="border-t border-line px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          Green dot = worked in the last 24 hours · moving dots = work handed from one agent to the next · click anyone
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {ordered.map((a) => {
          const c = TEAM_COLOR[a.team];
          const active = (live[a.key] ?? 0) > 0;
          return (
            <button
              key={a.key}
              onClick={() => setSelected(a.key)}
              className={`panel flex items-center gap-3 p-3 text-left transition hover:border-line-strong ${a.key === selected ? "border-line-strong" : ""}`}
              style={a.key === selected ? { boxShadow: `0 0 0 1px ${c}, 0 0 22px -6px ${c}` } : undefined}
            >
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 font-mono font-bold" style={{ borderColor: c, color: c }}>
                {name(a).slice(0, 1).toUpperCase()}
                <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel-solid ${active ? "bg-mint" : "bg-faint"}`} />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{name(a)}</span>
                <span className="block truncate text-xs text-muted">{a.title}</span>
              </span>
            </button>
          );
        })}
      </section>
      </div>

      <AgentCard agent={sel} name={name(sel)} live={live[sel.key]} all={ordered} names={names} onPick={setSelected} />
    </div>
  );
}

function AgentCard({ agent: a, name, live, all, names, onPick }: { agent: Agent; name: string; live: number | null | undefined; all: Agent[]; names: Record<string, string>; onPick: (k: string) => void }) {
  const c = TEAM_COLOR[a.team];
  const from = all.filter((x) => x.feeds?.includes(a.key));
  const to = all.filter((x) => a.feeds?.includes(x.key));
  return (
    <aside className="panel relative overflow-hidden xl:sticky xl:top-4 xl:self-start" key={a.key}>
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: c, boxShadow: `0 0 18px ${c}` }} />
      <div className="p-5">
        <div className="flex items-center gap-4">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 font-mono text-2xl font-bold"
            style={{ borderColor: c, color: c, boxShadow: `0 0 24px -4px ${c}` }}
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: c }}>
              {a.team}
            </p>
            <h3 className="truncate text-2xl font-semibold text-ink">{name}</h3>
            <p className="text-sm text-muted">{a.title}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line p-3">
            <p className="panel-title">Last 24h</p>
            <p className="readout mt-1 text-xl">{live === null || live === undefined ? "—" : live.toLocaleString("en-US")}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="panel-title">Status</p>
            <p className={`mt-1 text-sm font-medium ${(live ?? 0) > 0 ? "text-mint" : "text-muted"}`}>{(live ?? 0) > 0 ? "● Working" : "○ Standing by"}</p>
          </div>
        </div>
        <p className="mt-2 font-mono text-[10px] text-faint">Powered by {a.brain}</p>

        <p className="panel-title mt-5">What they do</p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          {a.does.map((d) => (
            <li key={d} className="flex gap-2">
              <span style={{ color: c }}>▸</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>

        <p className="panel-title mt-5">When</p>
        <p className="mt-2 text-sm text-muted">{a.when}</p>

        <p className="panel-title mt-5">Never</p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          {a.never.map((d) => (
            <li key={d} className="flex gap-2">
              <span className="text-rose">✕</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>

        {(from.length > 0 || to.length > 0) && (
          <>
            <p className="panel-title mt-5">Works with</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {from.map((x) => (
                <button key={x.key} onClick={() => onPick(x.key)} className="chip border-line text-muted hover:text-ink">
                  ← from {names[x.key] ?? x.name}
                </button>
              ))}
              {to.map((x) => (
                <button key={x.key} onClick={() => onPick(x.key)} className="chip border-line text-muted hover:text-ink">
                  hands to {names[x.key] ?? x.name} →
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-xs">
          {a.seeIt && (
            <a href={a.seeIt.href} className="link">
              See their work: {a.seeIt.label}
            </a>
          )}
          <details>
            <summary className="cursor-pointer text-cyan">Rename</summary>
            <form action={renameAgent} className="mt-2 flex gap-2">
              <input type="hidden" name="key" value={a.key} />
              <input name="name" required maxLength={40} defaultValue={name} className="field" aria-label={`New name for the ${a.title}`} />
              <SubmitButton>Save</SubmitButton>
            </form>
          </details>
        </div>
      </div>
    </aside>
  );
}
