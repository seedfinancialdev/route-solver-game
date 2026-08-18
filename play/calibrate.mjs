// The budget-multiplier sweep.
//
// Sweeps the shortlist — every pair where the shortest road is measurably
// slower than the fastest — rather than data/puzzles.json. The shipped puzzles
// were *selected* for tension at the chosen multiplier, so measuring the
// multiplier against them would be circular.
//
// Two players matter:
//   shortestRouter — takes the shortest road every time. The trap the drawn
//                    map sets, and the strategy the budget has to defeat.
//   roadReader     — sees every road's length exactly and misjudges its speed,
//                    looks three hops ahead. The player the budget is set for.

import { readFileSync } from 'node:fs';
import { buildGraph, dijkstra, pathFrom } from '../scripts/lib/graph.mjs';
import { shortestRouter, roadReader } from './bots.mjs';

const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));
const byMin = Array.from({ length: g.n }, (_, i) => dijkstra(g, i, (e) => e.min));

const MIN_PENALTY = 1.12;
const TRIALS = 6;
const MULTIPLIERS = [1.02, 1.04, 1.06, 1.08, 1.10, 1.12, 1.15];

const pool = [];
for (let a = 0; a < g.n; a++) {
  for (let b = a + 1; b < g.n; b++) {
    const optMin = byMin[a].dist[b];
    if (optMin < 12 * 60 || optMin > 40 * 60) continue;
    const hops = pathFrom(byMin[a].prev, a, b).length - 1;
    if (hops < 7 || hops > 16) continue;
    const short = shortestRouter(g, a, b).minutes;
    if (short / optMin < MIN_PENALTY) continue;
    pool.push({ a, b, optMin, short });
  }
}

const runs = pool.map((p) => ({
  ...p,
  reader: Array.from({ length: TRIALS }, (_, t) =>
    roadReader(g, p.a, p.b, { seed: p.a * 977 + p.b * 13 + t }).minutes),
}));

const hrs = (m) => (m / 60).toFixed(1);
console.log(`sweep over ${pool.length} candidate pairs, ${TRIALS} runs each\n`);
console.log('mult   shortest-road wins   road-reader wins   median win margin   median bust');
for (const m of MULTIPLIERS) {
  let shortWins = 0, readerWins = 0, n = 0;
  const margins = [], busts = [];
  for (const r of runs) {
    const budget = r.optMin * m;
    if (r.short <= budget) shortWins++;
    for (const t of r.reader) {
      n++;
      if (!Number.isFinite(t)) continue;
      if (t <= budget) { readerWins++; margins.push(budget - t); } else busts.push(t - budget);
    }
  }
  const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
  console.log(
    `${m.toFixed(2)}   ${`${(shortWins / pool.length * 100).toFixed(0)}%`.padStart(17)}   `
    + `${`${(readerWins / n * 100).toFixed(0)}%`.padStart(16)}   `
    + `${`${hrs(med(margins))}h`.padStart(17)}   ${`${hrs(med(busts))}h`.padStart(11)}`,
  );
}
console.log('\nThe multiplier has to sit below the point where taking the shortest road');
console.log('starts getting away with it — past that the trap stops being a trap.');
