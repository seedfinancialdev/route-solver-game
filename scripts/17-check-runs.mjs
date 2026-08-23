// Runs the career routes against the criteria in
// docs/superpowers/specs/2026-08-22-run-criteria.md, over the real road graph.
//
// Only the gates that can honestly be measured today are checked. Section C
// (fuel, borders, enforcement, the Google penalty) needs systems that do not
// exist yet, and terminal/named endpoints are editorial judgements, not
// computations. Those are reported as PENDING rather than quietly passed.
//
// Usage: npm run runs:check

import { readFileSync } from 'node:fs';
import { loadGraph, nearestNode, route, corridors } from './lib/road-graph.mjs';

const GRAPH = 'data/road-graph';
const MIN_KM = 2500;
const MIN_HOURS = 24;
const MAX_HOURS = 72;
const TOLERANCE = 1.20;      // corridors within +20% — see the spec on why not 15
const MIN_CORRIDORS = 2;
const MIN_SPREAD = 0.10;     // "genuinely different roads", the spec's own anchor
const MIN_SHORTEST_PENALTY = 0.12;

const g = loadGraph(GRAPH);
const runs = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs;
const CLS = g.meta.classes;

/** Share of a corridor's length in each road class, links folded into parents. */
function classMix(edges) {
  const mix = new Map();
  let total = 0;
  for (const e of edges) {
    const k = CLS[g.cls[e]].replace('_link', '');
    mix.set(k, (mix.get(k) || 0) + g.m[e]);
    total += g.m[e];
  }
  for (const [k, v] of mix) mix.set(k, v / (total || 1));
  return mix;
}

/** Total-variation distance between two mixes: 0 identical, 1 disjoint. */
function spread(a, b) {
  let d = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) d += Math.abs((a.get(k) || 0) - (b.get(k) || 0));
  return d / 2;
}

let anyFail = false;
const line = (ok, label, detail) => {
  if (ok === false) anyFail = true;
  const tag = ok === null ? 'PENDING' : ok ? '   ok  ' : '  FAIL ';
  console.log(`  ${tag}  ${label.padEnd(30)} ${detail}`);
};

console.log(`graph: ${g.n.toLocaleString()} nodes, ${g.e.toLocaleString()} edges, `
  + `${g.meta.totalKm.toLocaleString()} km, ${g.meta.maxspeedRealPct}% real maxspeed\n`);

for (const r of runs) {
  console.log(`${r.name}  —  ${r.from.name} to ${r.to.name}`);
  const a = nearestNode(g, r.from.lon, r.from.lat);
  const b = nearestNode(g, r.to.lon, r.to.lat);

  const cs = corridors(g, a, b, { tolerance: TOLERANCE, rounds: 12 });
  if (!cs.length) { line(false, 'routable', 'no route found'); continue; }
  const best = cs[0];
  const hours = best.minutes / 60;

  // --- A: scope ---
  line(best.km >= MIN_KM, 'distance', `${best.km.toFixed(0)} km (need ${MIN_KM})`);
  line(hours >= MIN_HOURS && hours <= MAX_HOURS, 'elapsed at legal speed',
    `${hours.toFixed(1)} h (need ${MIN_HOURS}-${MAX_HOURS})`);
  line(null, 'countries crossed', 'graph carries no country tag yet');
  line(null, 'terminal + named endpoints', 'editorial, not computable');

  // --- B: strategy ---
  line(cs.length >= MIN_CORRIDORS, 'distinct corridors',
    `${cs.length} within +${Math.round((TOLERANCE - 1) * 100)}% (need ${MIN_CORRIDORS})`);

  const mixes = cs.map((c) => classMix(c.edges));
  let widest = 0;
  for (let i = 0; i < mixes.length; i++) {
    for (let j = i + 1; j < mixes.length; j++) widest = Math.max(widest, spread(mixes[i], mixes[j]));
  }
  line(widest >= MIN_SPREAD, 'corridor character spread',
    `${widest.toFixed(3)} (need ${MIN_SPREAD})`);

  // Shortest by distance, costed in time: the game's thesis is that it loses.
  const shortest = route(g, a, b, null, true);
  if (shortest) {
    const penalty = shortest.minutes / best.minutes - 1;
    line(penalty >= MIN_SHORTEST_PENALTY, 'shortest is not fastest',
      `shortest route is +${(100 * penalty).toFixed(1)}% slower (need +${100 * MIN_SHORTEST_PENALTY}%)`);
  }

  // --- C: constraint bite ---
  line(null, 'fuel / borders / enforcement', 'systems do not exist yet');
  line(null, 'Google penalty', 'needs the systems above');

  for (const [i, c] of cs.entries()) {
    const top = [...mixes[i]].sort((x, y) => y[1] - x[1]).slice(0, 3)
      .map(([k, v]) => `${k} ${(100 * v).toFixed(0)}%`).join('  ');
    console.log(`         corridor ${i}: ${c.km.toFixed(0).padStart(5)} km  `
      + `${(c.minutes / 60).toFixed(1).padStart(5)} h  ${top}`);
  }
  console.log();
}

console.log(anyFail ? 'Some measurable gates FAILED.' : 'Every measurable gate passes.');
process.exit(anyFail ? 1 : 0);
