"use client";

import { useMemo, useState } from "react";
import { COUNTIES_BY_STATE, STATE_NAMES } from "@/lib/counties";
import { DOLLARS_PER_CREDIT, MAX_TASKS_PER_SEARCH } from "@/lib/leads-shared";
import { SubmitButton } from "@/components/submit-button";
import { startSearch } from "./actions";

// JPR's home counties (Jefferson and the ones around it).
const HOME = ["Jefferson County", "Clearfield County", "Indiana County", "Armstrong County", "Clarion County", "Elk County", "Forest County"];

// Kinds of employers that usually have 5+ people, for a first local run.
const LOCAL_KEYWORDS = [
  "manufacturing company", "machine shop", "metal fabrication", "welding shop", "construction company", "excavating contractor",
  "trucking company", "warehouse", "HVAC contractor", "plumbing contractor", "electrical contractor", "car dealership",
  "hospital", "nursing home", "home health care", "medical clinic", "dental office", "veterinary clinic",
  "bank", "credit union", "insurance agency", "accounting firm", "law firm", "engineering firm",
  "hotel", "grocery store", "lumber company", "sawmill", "oil and gas company", "plastics manufacturer",
];
const USA_KEYWORDS = ["machine shop", "CNC machining", "precision machining", "metal fabrication", "manufacturing company"];
const AI_KEYWORDS = ["insurance agency", "accounting firm", "law firm", "dental office", "HVAC contractor", "real estate office", "property management company", "medical clinic"];
const DEFAULTS: Record<string, string[]> = { local: LOCAL_KEYWORDS, usa: USA_KEYWORDS, ai: AI_KEYWORDS };

export function NewSearch({ line: startLine, hasKey, creditsUsed, freeCredits }: { line: string; hasKey: boolean; creditsUsed: number; freeCredits: number }) {
  const [line, setLine] = useState(startLine);
  const [keywords, setKeywords] = useState(DEFAULTS[startLine].join("\n"));
  const [state, setState] = useState("PA");
  const [picked, setPicked] = useState<Set<string>>(new Set(HOME.map((c) => `PA|${c}`)));
  const [pages, setPages] = useState(2);

  const kw = useMemo(() => [...new Set(keywords.split(/[\n,]+/).map((k) => k.trim()).filter((k) => k.length >= 2))], [keywords]);
  const tasks = kw.length * picked.size;
  const maxCredits = tasks * pages;
  const freeLeft = Math.max(0, freeCredits - creditsUsed);
  const paid = Math.max(0, maxCredits - freeLeft);
  const tooBig = tasks > MAX_TASKS_PER_SEARCH;
  const counties = COUNTIES_BY_STATE[state] ?? [];
  const pickedHere = counties.filter((c) => picked.has(`${state}|${c}`)).length;
  const pickedStates = [...new Set([...picked].map((p) => p.split("|")[0]))];

  const toggle = (key: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  const setAll = (on: boolean) => setPicked((p) => {
    const n = new Set(p);
    for (const c of counties) {
      if (on) n.add(`${state}|${c}`);
      else n.delete(`${state}|${c}`);
    }
    return n;
  });

  return (
    <form action={startSearch} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Which list</span>
          <select
            name="line"
            value={line}
            onChange={(e) => {
              const l = e.target.value;
              // Swap in that business's starter keywords unless they've been edited.
              if (keywords === DEFAULTS[line].join("\n")) setKeywords(DEFAULTS[l].join("\n"));
              setLine(l);
            }}
            className="field"
          >
            <option value="local">JPR Local</option>
            <option value="usa">JPR USA</option>
            <option value="ai">JPR AI</option>
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-muted">Name (optional)</span>
          <input name="name" placeholder="Filled in for you" className="field" />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-muted">Keywords, one per line ({kw.length})</span>
        <textarea name="keywords" rows={6} value={keywords} onChange={(e) => setKeywords(e.target.value)} className="field font-mono text-xs" />
      </label>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Counties in</span>
          <select value={state} onChange={(e) => setState(e.target.value)} className="field w-auto py-1">
            {Object.keys(COUNTIES_BY_STATE).map((s) => (
              <option key={s} value={s}>
                {STATE_NAMES[s] ?? s}
              </option>
            ))}
          </select>
          <button type="button" className="btn-quiet text-xs" onClick={() => setAll(true)}>
            All {counties.length}
          </button>
          <button type="button" className="btn-quiet text-xs" onClick={() => setAll(false)}>
            None
          </button>
          {state === "PA" && (
            <button type="button" className="btn-quiet text-xs" onClick={() => setPicked((p) => new Set([...p, ...HOME.map((c) => `PA|${c}`)]))}>
              Our 7 home counties
            </button>
          )}
          <span className="text-faint">
            {pickedHere} here · {picked.size} picked{pickedStates.length > 1 ? ` across ${pickedStates.length} states` : ""}
          </span>
          {picked.size > 0 && (
            <button type="button" className="btn-quiet text-xs hover:text-rose" onClick={() => setPicked(new Set())}>
              Clear all
            </button>
          )}
        </div>
        <div className="grid max-h-56 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded border border-line p-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
          {counties.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input type="checkbox" checked={picked.has(`${state}|${c}`)} onChange={() => toggle(`${state}|${c}`)} />
              <span className="truncate">{c}</span>
            </label>
          ))}
        </div>
        {[...picked].map((a) => (
          <input key={a} type="hidden" name="area" value={a} />
        ))}
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-muted">Results per search</span>
        <select name="pages" value={pages} onChange={(e) => setPages(Number(e.target.value))} className="field w-auto">
          <option value={1}>Top results only (1 credit each)</option>
          <option value={2}>Up to 2 pages (recommended)</option>
          <option value={3}>Up to 3 pages, for big counties</option>
        </select>
      </label>

      <div className="rounded border border-line bg-white/[0.02] p-3 text-sm">
        <p>
          <span className="readout text-ink">{tasks.toLocaleString()}</span> Google Maps searches ({kw.length} keywords × {picked.size} counties), at most{" "}
          <span className="readout text-ink">{maxCredits.toLocaleString()}</span> Serper credits. Extra pages only run while they keep finding new businesses, so it&apos;s usually less.
        </p>
        <p className="mt-1 text-muted">
          {paid === 0
            ? `Covered by your free credits (${freeLeft.toLocaleString()} of ${freeCredits.toLocaleString()} left).`
            : `About $${(paid * DOLLARS_PER_CREDIT).toFixed(2)} beyond your free credits ($1 per 1,000 on Serper's $50 pack).`}{" "}
          Reading websites and the PA registry is free.
        </p>
        {tooBig && <p className="mt-1 text-rose">Too big for one run. Keep it under {MAX_TASKS_PER_SEARCH.toLocaleString()} searches.</p>}
        {!hasKey && <p className="mt-1 text-amber">The Serper key isn&apos;t in Vercel yet, so searches wait until it is.</p>}
      </div>

      <SubmitButton pendingText="Queuing…" disabled={!tasks || tooBig}>
        Start search
      </SubmitButton>
    </form>
  );
}
