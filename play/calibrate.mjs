// Phase 2, the part a human can't do 30 times: sweep the budget multiplier and
// see who survives. The interactive playtest (play/cli.mjs) is how you check
// the number by feel; this is how you find which number to check.

import { readFileSync } from 'node:fs';
import { buildGraph, dijkstra, pathFrom } from '../scripts/lib/graph.mjs';
import { naive, estimator, planner, humanish } from './bots.mjs';

const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));

// Sweep the shortlist — every pair where the naive move is measurably wrong —
// rather than data/puzzles.json. The shipped puzzles were *selected* for
// tension at 1.15, so measuring the multiplier against them would be circular.
const MIN_OPTIMAL_KM = 900, MAX_OPTIMAL_KM = 3200, MIN_HOPS = 7, MAX_HOPS = 16;
const sp = Array.from({ length: g.n }, (_, i) => dijkstra(g, i));
const pool = [];
for (let a = 0; a < g.n; a++) {
  for (let b = a + 1; b < g.n; b++) {
    const optimal = sp[a].dist[b];
    if (optimal < MIN_OPTIMAL_KM || optimal > MAX_OPTIMAL_KM) continue;
    const hops = pathFrom(sp[a].prev, a, b).length - 1;
    if (hops < MIN_HOPS || hops > MAX_HOPS) continue;
    const naiveCost = Math.min(naive(g, a, b).cost, naive(g, b, a).cost);
    if (!Number.isFinite(naiveCost) || naiveCost / optimal < 1.15) continue;
    pool.push({ a, b, optimal });
  }
}

const TRIALS = 8;
const MULTIPLIERS = [1.05, 1.08, 1.10, 1.12, 1.15, 1.18, 1.20, 1.25, 1.30];

// Pre-run every bot once per puzzle; only the budget changes across the sweep.
const runs = pool.map((p) => {
  const human = Array.from({ length: TRIALS }, (_, t) => humanish(g, p.a, p.b, { seed: p.a * 1000 + p.b + t }).cost);
  return {
    optimal: p.optimal,
    naive: naive(g, p.a, p.b).cost,
    estimator: estimator(g, p.a, p.b).cost,
    planner: planner(g, p.a, p.b).cost,
    human,
  };
});

const pct = (x) => `${(x * 100).toFixed(0)}%`;

console.log(`sweep over ${pool.length} candidate pairs, ${TRIALS} human trials each\n`);
console.log('mult   naive  estim  human  plan | human margin when won (km)   bust by (km)');
for (const m of MULTIPLIERS) {
  const rate = (pick) => {
    let win = 0, n = 0;
    for (const r of runs) {
      const budget = r.optimal * m;
      for (const c of [].concat(pick(r))) { n++; if (c <= budget) win++; }
    }
    return win / n;
  };
  const margins = [], busts = [];
  for (const r of runs) {
    const budget = r.optimal * m;
    for (const c of r.human) (c <= budget ? margins : busts).push(Math.abs(budget - c));
  }
  margins.sort((a, b) => a - b); busts.sort((a, b) => a - b);
  const med = (a) => (a.length ? Math.round(a[a.length >> 1]) : 0);
  console.log(
    `${m.toFixed(2)}   ${pct(rate((r) => r.naive)).padStart(5)}  ${pct(rate((r) => r.estimator)).padStart(5)}  `
    + `${pct(rate((r) => r.human)).padStart(5)}  ${pct(rate((r) => r.planner)).padStart(5)} | `
    + `median ${String(med(margins)).padStart(4)}, p90 ${String(margins.length ? Math.round(margins[Math.floor(margins.length * 0.9)]) : 0).padStart(4)}   `
    + `median ${med(busts)}`,
  );
}
