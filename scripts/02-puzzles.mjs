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
// "The best time" is the fastest *legal* time: the driving-hours rule (EC
// 561/2006, simplified — 4.5 continuous hours forces a 45-minute break,
// scripts/lib/graph.mjs hosDijkstra/hosCost) applies to every route, not just
// the shortest one, and it doesn't land evenly — measured overhead across the
// graph ranges 11-17% depending on the route. That's wide enough that a pair
// selected as a trap under plain drive-time can stop being one once both
// routes pay their real HOS cost (measured directly: recomputing the old
// selection's budgets under HOS without reselecting left 8.5% of pairs where
// the shortest road outright won). So this reselects from scratch with HOS
// costs at every stage, rather than patching the old selection's numbers.
//
// Output: data/puzzles.json

import { readFileSync, writeFileSync } from 'node:fs';
import { haversineKm } from './lib/geo.mjs';
import { buildGraph, dijkstra } from './lib/graph.mjs';
import { shortestRouter, roadReader, hosOptimal } from '../play/bots.mjs';

const BUDGET_MULTIPLIER = Number(process.env.BUDGET_MULTIPLIER || 1.11);
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

// --- stage 1: cheap filters, then the exact (expensive) HOS check ----------
// hosOptimal searches a (city, minutes-since-rest) state space — real, but
// too expensive to run on all ~111k pairs. Two cheap nets narrow the field
// first, both using numbers that are already sitting around or trivial to get:
//  1. Plain drive-time bounds (byMin, already computed per source), widened
//     asymmetrically since HOS only ever adds time: the low end needs
//     dividing by roughly the worst overhead seen (up to ~1.17x), the high
//     end only needs a small safety margin below the best case.
//  2. shortestRouter's real (cheap — one fixed path, no search) HOS cost,
//     checked against a rough estimate of the true optimum. Loosened well
//     below the real 1.12x bar so nothing genuine gets cut on the estimate.
const LOW_MARGIN = 1.25;
const HIGH_SAFETY = 1.05;
const PREFILTER_PENALTY = 1.05;
const RATIO_ESTIMATE = 1.15; // median measured HOS/plain overhead across the graph

const shortlist = [];
let preScanned = 0, total = 0;
const t0 = Date.now();
for (let a = 0; a < g.n; a++) {
  for (let b = a + 1; b < g.n; b++) {
    total++;
    const plainOpt = byMin[a].dist[b];
    if (plainOpt < (MIN_HOURS * 60) / LOW_MARGIN || plainOpt > (MAX_HOURS * 60) / HIGH_SAFETY) continue;
    const short = shortestRouter(g, a, b);
    const estOpt = plainOpt * RATIO_ESTIMATE;
    if (short.minutes / estOpt < PREFILTER_PENALTY) continue;
    preScanned++;
    if (preScanned % 500 === 0) {
      console.log(`  ${preScanned} pre-filtered so far (${shortlist.length} qualifying), `
        + `${((Date.now() - t0) / 1000).toFixed(0)}s, ${(total / (g.n * (g.n - 1) / 2) * 100).toFixed(0)}% scanned`);
    }
    const opt = hosOptimal(g, a, b);
    if (opt.stuck) continue;
    const hops = opt.path.length - 1;
    if (opt.minutes < MIN_HOURS * 60 || opt.minutes > MAX_HOURS * 60) continue;
    if (hops < MIN_HOPS || hops > MAX_HOPS) continue;
    const penalty = short.minutes / opt.minutes;
    if (penalty < MIN_SHORTEST_PENALTY) continue;
    shortlist.push({
      a, b, optMin: opt.minutes, optKm: opt.km, optPath: opt.path, hops, shortMin: short.minutes, penalty,
    });
  }
}
console.log(`${shortlist.length} pairs where the shortest road is >= ${MIN_SHORTEST_PENALTY}x the fastest `
  + `*legal* time, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

// --- stage 2: simulate ------------------------------------------------------
const graded = shortlist.map((s) => {
  const runs = [];
  for (let t = 0; t < TRIALS; t++) {
    runs.push(roadReader(g, s.a, s.b, { seed: s.a * 977 + s.b * 13 + t, hos: true }).minutes);
    runs.push(roadReader(g, s.b, s.a, { seed: s.b * 977 + s.a * 13 + t, hos: true }).minutes);
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
  optimalKm: Math.round(r.optKm),
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
    hos: { continuousLimitMin: 270, breakMin: 45 },
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
