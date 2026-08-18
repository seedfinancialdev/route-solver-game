// The puzzle finder.
//
// The game's currency is TIME, and the trap is distance. The roads are drawn on
// the map, so a player can judge how long each hop is — what they cannot judge
// is how fast it runs. Across this graph the shortest route is the fastest one
// only 37% of the time; a motorway detour routinely beats a direct mountain
// road. A puzzle is a pair where that gap is wide enough to decide the round.
//
// Four things have to be true:
//
//   1. The shortest road is measurably slower  (>= 1.12x the best time).
//   2. It is winnable                          (a good read comes in under budget).
//   3. It is not free                          (a sloppy one does not).
//   4. Losing is a near miss                   (the worst realistic run is <= 1.45x).
//
// Criteria 2-4 are measured by simulating `roadReader` from play/bots.mjs, which
// sees every road's length exactly and misjudges its speed.
//
// Output: data/puzzles.json

import { readFileSync, writeFileSync } from 'node:fs';
import { haversineKm } from './lib/geo.mjs';
import { buildGraph, dijkstra, pathFrom } from './lib/graph.mjs';
import { shortestRouter, roadReader } from '../play/bots.mjs';

const BUDGET_MULTIPLIER = Number(process.env.BUDGET_MULTIPLIER || 1.08);
const MIN_SHORTEST_PENALTY = 1.12;
const MAX_WORST_RATIO = 1.45;
const MIN_HOURS = 12;
const MAX_HOURS = 40;
const MIN_HOPS = 7;
const MAX_HOPS = 16;
const TRIALS = 6;

const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));
const byMin = Array.from({ length: g.n }, (_, i) => dijkstra(g, i, (e) => e.min));
const nm = (i) => g.cities[i].name;

const legTime = (path) => {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += g.adj[path[i - 1]].find((e) => e.to === path[i]).min;
  return m;
};
const legKm = (path) => {
  let k = 0;
  for (let i = 1; i < path.length; i++) k += g.adj[path[i - 1]].find((e) => e.to === path[i]).km;
  return k;
};

// --- stage 1: cheap filters ------------------------------------------------
const shortlist = [];
for (let a = 0; a < g.n; a++) {
  for (let b = a + 1; b < g.n; b++) {
    const optMin = byMin[a].dist[b];
    if (optMin < MIN_HOURS * 60 || optMin > MAX_HOURS * 60) continue;
    const fastPath = pathFrom(byMin[a].prev, a, b);
    const hops = fastPath.length - 1;
    if (hops < MIN_HOPS || hops > MAX_HOPS) continue;
    const short = shortestRouter(g, a, b);
    const penalty = short.minutes / optMin;
    if (penalty < MIN_SHORTEST_PENALTY) continue;
    shortlist.push({ a, b, optMin, hops, fastPath, shortMin: short.minutes, penalty });
  }
}
console.log(`${shortlist.length} pairs where the shortest road is >= ${MIN_SHORTEST_PENALTY}x the best time`);

// --- stage 2: simulate ------------------------------------------------------
const graded = shortlist.map((s) => {
  const runs = [];
  for (let t = 0; t < TRIALS; t++) {
    runs.push(roadReader(g, s.a, s.b, { seed: s.a * 977 + s.b * 13 + t }).minutes);
    runs.push(roadReader(g, s.b, s.a, { seed: s.b * 977 + s.a * 13 + t }).minutes);
  }
  runs.sort((x, y) => x - y);
  const at = (p) => runs[Math.floor(runs.length * p)] / s.optMin;
  return { ...s, best: at(0.1), typical: at(0.5), worst: at(0.9) };
});

const chosen = graded.filter((r) =>
  r.best <= BUDGET_MULTIPLIER
  && r.worst >= BUDGET_MULTIPLIER
  && r.worst <= MAX_WORST_RATIO);

console.log(`${chosen.length} survive the tension filters at a ${BUDGET_MULTIPLIER}x budget`);

// --- stage 3: schedule ------------------------------------------------------
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

const puzzles = schedule.map((r) => ({
  a: r.a, b: r.b,
  optimalMin: Math.round(r.optMin),
  optimalKm: Math.round(legKm(r.fastPath)),
  // The trap, kept so the reveal can show what taking the short way would have cost.
  shortestMin: Math.round(r.shortMin),
  budgetMin: Math.round((r.optMin * BUDGET_MULTIPLIER) / 15) * 15,
  hops: r.hops,
  crow: Math.round(haversineKm(g.cities[r.a], g.cities[r.b])),
}));

writeFileSync(
  new URL('../data/puzzles.json', import.meta.url),
  JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    currency: 'minutes',
    budgetMultiplier: BUDGET_MULTIPLIER,
    criteria: { MIN_SHORTEST_PENALTY, MAX_WORST_RATIO, MIN_HOURS, MAX_HOURS, MIN_HOPS, MAX_HOPS },
    puzzles,
  }) + '\n',
);

const q = (arr, p) => arr.slice().sort((x, y) => x - y)[Math.floor(arr.length * p)];
const hrs = (m) => (m / 60).toFixed(1);
console.log(`\n${puzzles.length} puzzles = ${(puzzles.length / 365).toFixed(1)} years of daily play`);
console.log(`optimal drive p10/p50/p90: ${[0.1, 0.5, 0.9].map((p) => hrs(q(puzzles.map((x) => x.optimalMin), p))).join('/')} hours`);
console.log(`hops       p10/p50/p90: ${[0.1, 0.5, 0.9].map((p) => q(puzzles.map((x) => x.hops), p)).join('/')}`);
console.log(`the short way costs p50/p90: +${[0.5, 0.9].map((p) => hrs(q(puzzles.map((x) => x.shortestMin - x.optimalMin), p))).join('/+')} hours`);
console.log(`distinct cities used as endpoints: ${new Set(puzzles.flatMap((p) => [p.a, p.b])).size} of ${g.n}`);
console.log('\nfirst eight days:');
puzzles.slice(0, 8).forEach((p, i) => console.log(
  `  day ${String(i + 1).padStart(2)}  ${nm(p.a)} -> ${nm(p.b)}`.padEnd(44)
  + `budget ${hrs(p.budgetMin)}h (fastest ${hrs(p.optimalMin)}h, shortest road ${hrs(p.shortestMin)}h, ${p.hops} hops)`));
