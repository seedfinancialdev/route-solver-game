// One-off: how often does "hop to whatever's closest to the target, every
// time" — no route-planning, no lookahead — land in budget on the shipped
// puzzles? Answers the difficulty-brainstorm question directly rather than
// by argument.

import { readFileSync } from 'node:fs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { naive, shortestRouter } from './bots.mjs';

const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));
const pack = JSON.parse(readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8'));

let naiveWins = 0, naiveStuck = 0, shortWins = 0;
const margins = [], busts = [], ratios = [];
for (const p of pack.puzzles) {
  const r = naive(g, p.a, p.b);
  if (r.stuck) { naiveStuck++; continue; }
  ratios.push(r.minutes / p.optimalMin);
  if (r.minutes <= p.budgetMin) { naiveWins++; margins.push(p.budgetMin - r.minutes); }
  else busts.push(r.minutes - p.budgetMin);
  if (shortestRouter(g, p.a, p.b).minutes <= p.budgetMin) shortWins++;
}

const n = pack.puzzles.length;
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
console.log(`${n} shipped puzzles`);
console.log(`naive (hop toward target, ignore cost): ${naiveWins} wins (${(naiveWins / n * 100).toFixed(1)}%), `
  + `${naiveStuck} dead ends (${(naiveStuck / n * 100).toFixed(1)}%)`);
console.log(`  median time vs optimal: ${med(ratios).toFixed(3)}x`);
console.log(`  median margin when it wins: ${(med(margins) / 60).toFixed(1)}h, `
  + `median bust when it loses: ${(med(busts) / 60).toFixed(1)}h`);
console.log(`shortestRouter (global shortest-km path): ${shortWins} wins (${(shortWins / n * 100).toFixed(1)}%)`);
