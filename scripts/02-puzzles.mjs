// Phase 1 + 2 combined: find the pairs worth playing, and schedule them.
//
// Four things have to be true of a puzzle, and only the first came free:
//
//   1. The naive move is measurably wrong  (greedy >= 1.15x optimal).
//   2. It is winnable                      (a good run comes in under budget).
//   3. It is not free                      (a sloppy run does not).
//   4. Losing is a near miss               (the worst realistic run is <= 1.6x
//                                           optimal, so you bust by 100 km,
//                                           not by walking into the Adriatic).
//
// Criteria 2-4 are measured by simulating the `humanish` player from play/bots.mjs
// several times per pair. See docs/SPEC.md for why the multiplier is 1.15.
//
// Output: data/puzzles.json

import { readFileSync, writeFileSync } from 'node:fs';
import { haversineKm } from './lib/geo.mjs';
import { buildGraph, dijkstra, pathFrom, countRoutesUnderBudget } from './lib/graph.mjs';
import { naive, planner, humanish } from '../play/bots.mjs';

const BUDGET_MULTIPLIER = Number(process.env.BUDGET_MULTIPLIER || 1.15);
const MIN_NAIVE_RATIO = 1.15;
const MAX_WORST_RATIO = 1.6;
const MIN_OPTIMAL_KM = 900;
const MAX_OPTIMAL_KM = 3200;
const MIN_HOPS = 5;
const MAX_HOPS = 16;
const TRIALS = 6;

const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));
const sp = Array.from({ length: g.n }, (_, i) => dijkstra(g, i));
const nm = (i) => g.cities[i].name;

// --- stage 1: cheap filters ------------------------------------------------
const shortlist = [];
for (let a = 0; a < g.n; a++) {
  for (let b = a + 1; b < g.n; b++) {
    const optimal = sp[a].dist[b];
    if (optimal < MIN_OPTIMAL_KM || optimal > MAX_OPTIMAL_KM) continue;
    const hops = pathFrom(sp[a].prev, a, b).length - 1;
    if (hops < MIN_HOPS || hops > MAX_HOPS) continue;
    // Greedy runs both directions; keep the kinder one so a puzzle is fair
    // whichever end it is played from.
    const naiveCost = Math.min(naive(g, a, b).cost, naive(g, b, a).cost);
    if (!Number.isFinite(naiveCost) || naiveCost / optimal < MIN_NAIVE_RATIO) continue;
    shortlist.push({ a, b, optimal, hops, naiveCost });
  }
}
console.log(`${shortlist.length} pairs where the obvious move is wrong by >= ${MIN_NAIVE_RATIO}x`);

// --- stage 2: simulate ------------------------------------------------------
const graded = [];
for (const s of shortlist) {
  const runs = [];
  for (let t = 0; t < TRIALS; t++) {
    runs.push(humanish(g, s.a, s.b, { seed: s.a * 977 + s.b * 13 + t }).cost);
    runs.push(humanish(g, s.b, s.a, { seed: s.b * 977 + s.a * 13 + t }).cost);
  }
  runs.sort((x, y) => x - y);
  const at = (p) => runs[Math.floor(runs.length * p)] / s.optimal;
  graded.push({ ...s, best: at(0.1), typical: at(0.5), worst: at(0.9) });
}

const chosen = graded.filter((r) =>
  r.best <= BUDGET_MULTIPLIER      // a good run gets there
  && r.worst >= BUDGET_MULTIPLIER  // a sloppy one doesn't
  && r.worst <= MAX_WORST_RATIO);  // and losing is a near miss

console.log(`${chosen.length} survive the tension filters at a ${BUDGET_MULTIPLIER}x budget`);

// --- stage 3: schedule ------------------------------------------------------
// One puzzle a day, in a fixed order everyone shares. The only scheduling rule
// is that a city shouldn't headline twice inside a fortnight.
const RECENT = 14;
const pool = chosen
  .map((r) => ({ ...r, key: (r.a * 7919 + r.b * 104729) % 100003 }))
  .sort((x, y) => x.key - y.key);

const schedule = [];
const recent = [];
while (pool.length) {
  let idx = pool.findIndex((p) => !recent.includes(p.a) && !recent.includes(p.b));
  if (idx === -1) idx = 0;
  const [p] = pool.splice(idx, 1);
  schedule.push(p);
  recent.push(p.a, p.b);
  while (recent.length > RECENT) recent.shift();
}

const puzzles = schedule.map((r) => {
  const budget = Math.round((r.optimal * BUDGET_MULTIPLIER) / 10) * 10;
  const path = pathFrom(sp[r.a].prev, r.a, r.b);
  let minutes = 0;
  for (let i = 1; i < path.length; i++) minutes += g.adj[path[i - 1]].find((e) => e.to === path[i]).min;
  return {
    a: r.a, b: r.b,
    optimal: Math.round(r.optimal),
    optimalMin: Math.round(minutes),
    budget,
    hops: r.hops,
    crow: Math.round(haversineKm(g.cities[r.a], g.cities[r.b])),
    naive: Math.round(r.naiveCost),
    routes: countRoutesUnderBudget(g, r.a, r.b, budget, sp[r.b].dist, 200),
  };
});

writeFileSync(
  new URL('../data/puzzles.json', import.meta.url),
  JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    budgetMultiplier: BUDGET_MULTIPLIER,
    criteria: { MIN_NAIVE_RATIO, MAX_WORST_RATIO, MIN_OPTIMAL_KM, MAX_OPTIMAL_KM, MIN_HOPS, MAX_HOPS },
    puzzles,
  }) + '\n',
);

// --- report ----------------------------------------------------------------
const q = (arr, p) => arr.slice().sort((x, y) => x - y)[Math.floor(arr.length * p)];
console.log(`\n${puzzles.length} puzzles = ${(puzzles.length / 365).toFixed(1)} years of daily play`);
console.log(`optimal km p10/p50/p90: ${[0.1, 0.5, 0.9].map((p) => q(puzzles.map((x) => x.optimal), p)).join('/')}`);
console.log(`hops       p10/p50/p90: ${[0.1, 0.5, 0.9].map((p) => q(puzzles.map((x) => x.hops), p)).join('/')}`);
console.log(`routes under budget p10/p50/p90: ${[0.1, 0.5, 0.9].map((p) => q(puzzles.map((x) => x.routes), p)).join('/')}`);
console.log(`distinct cities used as endpoints: ${new Set(puzzles.flatMap((p) => [p.a, p.b])).size} of ${g.n}`);
console.log('\nfirst ten days:');
puzzles.slice(0, 10).forEach((p, i) => console.log(
  `  day ${String(i + 1).padStart(2)}  ${nm(p.a)} -> ${nm(p.b)}`.padEnd(46)
  + `budget ${p.budget} km (optimal ${p.optimal}, naive ${p.naive}, ${p.hops} hops)`));
