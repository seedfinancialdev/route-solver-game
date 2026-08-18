// Phase 2, the part a human can't do 30 times: sweep the budget multiplier and
// see who survives. The interactive playtest (play/cli.mjs) is how you check
// the number by feel; this is how you find which number to check.

import { readFileSync } from 'node:fs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { naive, estimator, planner, humanish, oracle } from './bots.mjs';

const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));
const pool = JSON.parse(readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8')).puzzles;

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

console.log(`sweep over ${pool.length} puzzles, ${TRIALS} human trials each\n`);
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
