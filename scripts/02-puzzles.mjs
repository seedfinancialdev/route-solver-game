// The puzzle finder.
//
// The game's currency is TIME, and the trap is distance. The roads are drawn on
// the map, so a player can judge how long each hop is — what they cannot judge
// is how fast it runs. A puzzle is a pair where that gap is wide enough to
// decide the round. Four things have to be true:
//
//   1. The short way is measurably slower. The distance-optimal route costs
//      >= 1.12x the fastest *legal* route's time. This one is not a proxy
//      for difficulty that a better test could replace — it's a hard
//      requirement of the rules as written. The shortest road is a free,
//      deterministic, always-available strategy; nothing about taking it
//      requires reading a single pace tier. For it to fail, its time has to
//      exceed the budget, which means its ratio to the optimal has to clear
//      the budget multiplier (1.11) — 1.12 keeps a working margin above that
//      once 15-minute rounding is in play. (A version of this file briefly
//      dropped this gate on the theory that pace-misjudgment alone was
//      enough difficulty without a directional trap — measured after the
//      fact, that let the shortest road win outright on 66% of the puzzles
//      it produced, because the thing it was actually testing, the
//      simulated player's noisy performance, is a different question from
//      whether the deterministic shortest-road strategy itself survives.
//      It doesn't, below this ratio, ever.)
//   2. It is winnable.       A good run by the simulated player comes in under budget.
//   3. It is not free.       A sloppy run by the same player does not.
//   4. Losing is a near miss. The worst REALISTIC run is <= 1.45x the best time.
//
// "Realistic" matters for #4: a simulated player can occasionally dead-end
// itself (no unvisited neighbour left) purely from bounded lookahead, same as
// a real player can. That's real and it's meant to happen sometimes (see
// "Dead ends end the round" in the Rules) — but it's a genuinely different
// failure mode from "drove slower than planned," and letting one dead-end
// spike the worst-case time to Infinity conflated the two. Split out
// explicitly: dead-end rate is its own bounded criterion, and the time-ratio
// criteria are computed only over the runs that actually finished.
//
// "The best time" is the fastest *legal* time: the driving-hours rule (EC
// 561/2006, simplified — 4.5 continuous hours forces a 45-minute break,
// scripts/lib/graph.mjs hosDijkstra/hosCost) applies to every route, not just
// the shortest one, and it doesn't land evenly — measured overhead across the
// graph ranges 11-17% depending on the route.
//
// Criteria 2-4 are measured by simulating `roadReader` from play/bots.mjs,
// which sees every road's length exactly and misjudges its speed.
//
// Output: data/puzzles.json

import { readFileSync, writeFileSync } from 'node:fs';
import { haversineKm } from './lib/geo.mjs';
import { buildGraph, hosDijkstraBounded } from './lib/graph.mjs';
import { shortestRouter, roadReader } from '../play/bots.mjs';

const BUDGET_MULTIPLIER = Number(process.env.BUDGET_MULTIPLIER || 1.11);
const MAX_WORST_RATIO = 1.45;
const MAX_STUCK_RATE = 0.15; // >15% of a bounded-lookahead player's runs dead-ending isn't "rare"
const MIN_HOURS = 12;
const MAX_HOURS = 40;
const MIN_HOPS = 7;
const MAX_HOPS = 16;
const TRIALS = 6;
const MIN_SHORTEST_PENALTY = 1.12; // see criterion 1 above

const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));
const nm = (i) => g.cities[i].name;

// --- stage 1: one bounded search per source, not one per pair --------------
// hosDijkstraBounded(src) explores the (city, minutes-since-rest) state space
// out to the 40h ceiling and harvests the optimal arrival at every city it
// passes on the way — Dijkstra visits states in increasing-distance order, so
// that's a free byproduct of finding the single farthest one. Calling
// hosDijkstra(a, b) separately per candidate pair re-explores the same
// neighbourhood from scratch for every b a given a is checked against;
// verified equivalent (0 mismatches across 120 spot-checked pairs) and
// ~100x faster in practice. This is also what keeps a much bigger roster
// tractable later — the search is bounded by drive-time, not by how many
// cities exist, so it stays cheap as long as one region's search doesn't
// have to explore the whole graph.
const shortlist = [];
const t0 = Date.now();
for (let a = 0; a < g.n; a++) {
  const reached = hosDijkstraBounded(g, a, MAX_HOURS * 60);
  for (const [b, { minutes, path }] of reached) {
    if (b <= a) continue; // each unordered pair once, direction a -> b
    if (minutes < MIN_HOURS * 60) continue;
    const hops = path.length - 1;
    if (hops < MIN_HOPS || hops > MAX_HOPS) continue;
    const short = shortestRouter(g, a, b); // real HOS cost, cheap (one fixed path)
    if (short.minutes / minutes < MIN_SHORTEST_PENALTY) continue; // criterion 1
    shortlist.push({
      a, b, optMin: minutes, optKm: path.reduce((t, v, i) => (
        i ? t + g.adj[path[i - 1]].find((e) => e.to === v).km : 0), 0),
      hops, shortMin: short.minutes, penalty: short.minutes / minutes,
    });
  }
  if ((a + 1) % 50 === 0 || a === g.n - 1) {
    console.log(`  ${a + 1}/${g.n} source cities searched (${shortlist.length} qualifying so far), `
      + `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
console.log(`${shortlist.length} pairs in bounds (12-40h fastest-legal, 7-16 hops), `
  + `${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

// --- stage 2: simulate ------------------------------------------------------
const graded = shortlist.map((s) => {
  const raw = [];
  for (let t = 0; t < TRIALS; t++) {
    raw.push(roadReader(g, s.a, s.b, { seed: s.a * 977 + s.b * 13 + t, hos: true }).minutes);
    raw.push(roadReader(g, s.b, s.a, { seed: s.b * 977 + s.a * 13 + t, hos: true }).minutes);
  }
  const finite = raw.filter(Number.isFinite).sort((x, y) => x - y);
  const stuckRate = (raw.length - finite.length) / raw.length;
  const at = (p) => (finite.length ? finite[Math.floor(finite.length * p)] / s.optMin : Infinity);
  return { ...s, best: at(0.1), typical: at(0.5), worst: at(0.9), stuckRate };
});

const chosen = graded.filter((r) =>
  r.stuckRate <= MAX_STUCK_RATE
  && r.best <= BUDGET_MULTIPLIER
  && r.worst >= BUDGET_MULTIPLIER
  && r.worst <= MAX_WORST_RATIO);

console.log(`${chosen.length} survive the tension filters at a ${BUDGET_MULTIPLIER}x budget `
  + `(${graded.filter((r) => r.stuckRate > MAX_STUCK_RATE).length} cut on dead-end rate alone)`);

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
    criteria: { MIN_SHORTEST_PENALTY, MAX_WORST_RATIO, MAX_STUCK_RATE, MIN_HOURS, MAX_HOURS, MIN_HOPS, MAX_HOPS },
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
