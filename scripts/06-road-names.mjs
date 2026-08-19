// Phase 5: real road names and route numbers, for narration — never for
// gameplay. Re-queries the exact edges already in data/graph.json
// against the same public OSRM instance the whole graph was built from
// (scripts/lib/osrm.mjs), asking this time for what routePair() already
// throws away: each step's `name` and `ref`.
//
// This is additive only. It does not touch graph.json's km/min/geometry —
// the numbers the shipped puzzles' budgets are calibrated against — so a
// road briefly renamed on OpenStreetMap since the graph was built can't
// silently desync a puzzle from its budget.
//
// Output: data/road-names.json

import { readFileSync, writeFileSync } from 'node:fs';
import { namedRunsForPairs } from './lib/osrm.mjs';

const graph = JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8'));

const jobs = graph.edges.map((e) => ({
  a: graph.cities[e.a], b: graph.cities[e.b], key: `${e.a}-${e.b}`,
}));

console.log(`fetching names for ${jobs.length} edges (this is a fresh network call per edge`
  + ` unless data/raw/osrm-names-cache/ is already warm)...`);
const runsByEdge = await namedRunsForPairs(jobs, (done, total) => {
  if (done % 100 === 0 || done === total) console.log(`  ${done}/${total}`);
});

const roads = graph.edges.map((e, i) => {
  const runs = runsByEdge[i];
  if (!runs || !runs.length) return { a: e.a, b: e.b, dominant: null, runs: [] };
  const totalKm = runs.reduce((t, r) => t + r.km, 0) || 1;
  // The named run that covers the most ground on this specific hop — the one
  // sentence "you leave on the A1" is built to name.
  const dominant = runs.filter((r) => r.label).sort((x, y) => y.km - x.km)[0] || null;
  return {
    a: e.a, b: e.b,
    dominant: dominant && { label: dominant.label, km: Math.round(dominant.km), share: dominant.km / totalKm },
    // Kept for richer narration later — "mostly the A1, then the 663 for the
    // last stretch" — not just the single dominant name.
    runs: runs.map((r) => ({ label: r.label, km: Math.round(r.km * 10) / 10 })),
  };
});

writeFileSync(
  new URL('../data/road-names.json', import.meta.url),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), roads }) + '\n',
);

const named = roads.filter((r) => r.dominant).length;
const unnamed = roads.length - named;
console.log(`\n${named} of ${roads.length} edges have a dominant named/ref stretch, ${unnamed} don't `
  + `(rural roads with no ref and no name tag in OSM — narration falls back to a generic line for these)`);
const sample = roads.filter((r) => r.dominant).slice(0, 8);
for (const r of sample) {
  const from = graph.cities[r.a].name, to = graph.cities[r.b].name;
  console.log(`  ${from} -> ${to}: ${r.dominant.label} (${r.dominant.km} km, `
    + `${(r.dominant.share * 100).toFixed(0)}% of the hop)`);
}
