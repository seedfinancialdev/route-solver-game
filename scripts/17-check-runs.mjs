// Runs the career routes against the criteria in
// docs/superpowers/specs/2026-08-22-run-criteria.md, over the real road graph.
//
// A run is start, optional checkpoints, finish. A circuit is a run whose finish
// is its start, and it needs checkpoints or it is degenerate. Unordered
// checkpoints hand the player a sequencing problem instead of a corridor
// choice, and are gated differently: "does the order actually matter?"
//
// Only gates that can honestly be measured today are checked. Section C (fuel,
// borders, enforcement, the Google penalty) needs systems that do not exist,
// and terminal/named endpoints are editorial. Those report PENDING rather than
// quietly passing.
//
// Usage: npm run runs:check

import { readFileSync } from 'node:fs';
import { loadGraph, nearestNode, route, corridors, timesFrom, bestOrder } from './lib/road-graph.mjs';

const MIN_KM = 2500;
const MIN_HOURS = 24;
const MAX_HOURS = 72;
const TOLERANCE = 1.20;        // corridors within +20% — see the spec on why not 15
const MIN_CORRIDORS = 2;
const MIN_SPREAD = 0.10;       // "genuinely different roads", the spec's own anchor
const MIN_SHORTEST_PENALTY = 0.12;
const MIN_ORDER_GAP = 0.10;    // a circuit whose order barely matters is a formality

const g = loadGraph('data/road-graph');
const runs = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs;
const CLS = g.meta.classes;

const hm = (m) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;

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
  const checkpoints = r.checkpoints || [];
  const stops = [r.from, ...checkpoints, r.to];
  const nodes = stops.map((p) => nearestNode(g, p.lon, p.lat));
  console.log(`${r.name}  —  ${r.style}, ${checkpoints.length} checkpoint(s)`
    + `${checkpoints.length ? `, ${r.ordered ? 'ordered' : 'unordered'}` : ''}`);

  // --- leg costs between every pair, one sweep per stop rather than per pair --
  const matrix = nodes.map((src) => {
    const d = timesFrom(g, src);
    return nodes.map((dst) => d[dst]);
  });
  if (matrix.some((row) => row.some((v) => !Number.isFinite(v)))) {
    line(false, 'all legs routable', 'some pair is unreachable — check for a ferry-only gap');
    console.log();
    continue;
  }

  // --- the route as the player would best drive it ---------------------------
  let order = stops.map((_, i) => i);
  let seq = null;
  if (!r.ordered && checkpoints.length > 1) {
    seq = bestOrder(matrix, stops.length);
    order = seq.order;
  }

  let km = 0, minutes = 0;
  const edges = [];
  for (let i = 1; i < order.length; i++) {
    const leg = route(g, nodes[order[i - 1]], nodes[order[i]]);
    km += leg.km; minutes += leg.minutes; edges.push(...leg.edges);
  }
  const hours = minutes / 60;

  // --- A: scope --------------------------------------------------------------
  line(km >= MIN_KM, 'distance', `${km.toFixed(0)} km (need ${MIN_KM})`);
  line(hours >= MIN_HOURS && hours <= MAX_HOURS, 'elapsed at legal speed',
    `${hours.toFixed(1)} h (need ${MIN_HOURS}-${MAX_HOURS})`);
  line(null, 'countries crossed', 'graph carries no country tag yet');
  line(null, 'terminal + named endpoints', 'editorial, not computable');
  if (r.style === 'circuit') {
    line(checkpoints.length >= 1, 'circuit has checkpoints',
      `${checkpoints.length} (a circuit without them is degenerate)`);
  }

  // --- B: strategy -----------------------------------------------------------
  if (seq) {
    // A circuit's decision is sequencing, so that is what gets gated. Measured
    // best against MEDIAN ordering, not against the authored one: the authored
    // order only tests the author, while the median is where an uninformed
    // player lands.
    const greedyGap = seq.greedy / seq.minutes - 1;
    const medianGap = seq.median / seq.minutes - 1;
    line(greedyGap >= MIN_ORDER_GAP, 'checkpoint order is non-obvious',
      `greedy nearest-next costs +${(100 * greedyGap).toFixed(1)}% (need +${100 * MIN_ORDER_GAP}%)`);
    console.log(`           for scale: median of ${seq.permutations.toLocaleString()} orders `
      + `+${(100 * medianGap).toFixed(0)}%, worst +${(100 * (seq.worst / seq.minutes - 1)).toFixed(0)}%`);
    line(null, 'distinct corridors', 'not the gate for a sequencing run');
  } else {
    const cs = corridors(g, nodes[0], nodes[nodes.length - 1], { tolerance: TOLERANCE, rounds: 12 });
    line(cs.length >= MIN_CORRIDORS, 'distinct corridors',
      `${cs.length} within +${Math.round((TOLERANCE - 1) * 100)}% (need ${MIN_CORRIDORS})`);
    const mixes = cs.map((c) => classMix(c.edges));
    let widest = 0;
    for (let i = 0; i < mixes.length; i++) {
      for (let j = i + 1; j < mixes.length; j++) widest = Math.max(widest, spread(mixes[i], mixes[j]));
    }
    line(widest >= MIN_SPREAD, 'corridor character spread', `${widest.toFixed(3)} (need ${MIN_SPREAD})`);
    for (const [i, c] of cs.entries()) {
      const top = [...mixes[i]].sort((x, y) => y[1] - x[1]).slice(0, 3)
        .map(([k, v]) => `${k} ${(100 * v).toFixed(0)}%`).join('  ');
      console.log(`         corridor ${i}: ${c.km.toFixed(0).padStart(5)} km  ${hm(c.minutes).padStart(6)}  ${top}`);
    }
  }

  const shortest = route(g, nodes[0], nodes[nodes.length - 1], null, true);
  if (shortest && r.style !== 'circuit') {
    const penalty = shortest.minutes / route(g, nodes[0], nodes[nodes.length - 1]).minutes - 1;
    line(penalty >= MIN_SHORTEST_PENALTY, 'shortest is not fastest',
      `shortest route is +${(100 * penalty).toFixed(1)}% slower (need +${100 * MIN_SHORTEST_PENALTY}%)`);
  }

  // --- C: constraint bite ----------------------------------------------------
  line(null, 'fuel / borders / enforcement', 'systems do not exist yet');
  line(null, 'Google penalty', 'needs the systems above');

  if (seq) {
    console.log(`         best order: ${order.map((i) => stops[i].name).join(' -> ')}`);
    console.log(`         ${km.toFixed(0)} km, ${hm(minutes)}`);
  }
  console.log();
}

console.log(anyFail ? 'Some measurable gates FAILED.' : 'Every measurable gate passes.');
process.exit(anyFail ? 1 : 0);
