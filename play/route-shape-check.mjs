// One-off: two claims from live playtesting, checked against real data
// instead of taken on faith.
//
// 1. "Routes backwards don't make sense" — does the fastest route (the one
//    the game is built around) ever take a hop that increases straight-line
//    distance to the target, and if so how often/how much?
// 2. "These routes heavily favour Eastern Europe" — is there a real skew in
//    which countries the shipped puzzles start/end in?

import { readFileSync } from 'node:fs';
import { buildGraph, dijkstra, pathFrom } from '../scripts/lib/graph.mjs';
import { haversineKm } from '../scripts/lib/geo.mjs';

const graph = JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8'));
const pack = JSON.parse(readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8'));
const g = buildGraph(graph);

// --- 1. backward hops on the fastest route ----------------------------------
let hopsTotal = 0, hopsBackward = 0, pathsWithBackward = 0, worstRegression = 0;
const regressions = [];
for (const p of pack.puzzles) {
  const { prev } = dijkstra(g, p.a, (e) => e.min);
  const path = pathFrom(prev, p.a, p.b);
  const target = g.cities[p.b];
  let hadBackward = false;
  for (let i = 1; i < path.length; i++) {
    const before = haversineKm(g.cities[path[i - 1]], target);
    const after = haversineKm(g.cities[path[i]], target);
    hopsTotal++;
    if (after > before) {
      hopsBackward++;
      hadBackward = true;
      const regress = after - before;
      worstRegression = Math.max(worstRegression, regress);
      regressions.push({ a: p.a, b: p.b, from: path[i - 1], to: path[i], regress });
    }
  }
  if (hadBackward) pathsWithBackward++;
}
console.log(`=== backward hops on the fastest route, ${pack.puzzles.length} shipped puzzles ===`);
console.log(`${hopsBackward} of ${hopsTotal} hops (${(hopsBackward / hopsTotal * 100).toFixed(1)}%) `
  + `move farther from the target than the previous city was`);
console.log(`${pathsWithBackward} of ${pack.puzzles.length} puzzles (${(pathsWithBackward / pack.puzzles.length * 100).toFixed(1)}%) `
  + `have at least one such hop on the fastest route`);
console.log(`worst single regression: ${worstRegression.toFixed(0)} km`);
regressions.sort((a, b) => b.regress - a.regress);
console.log('worst 8:');
for (const r of regressions.slice(0, 8)) {
  console.log(`  ${g.cities[r.from].name} -> ${g.cities[r.to].name} (${r.a}->${r.b} puzzle): `
    + `+${r.regress.toFixed(0)} km farther from target`);
}

// --- 2. country skew ---------------------------------------------------------
const countryOf = (i) => g.cities[i].country;
const startCounts = {}, endCounts = {}, eitherCounts = {};
for (const p of pack.puzzles) {
  const a = countryOf(p.a), b = countryOf(p.b);
  startCounts[a] = (startCounts[a] || 0) + 1;
  endCounts[b] = (endCounts[b] || 0) + 1;
  eitherCounts[a] = (eitherCounts[a] || 0) + 1;
  if (b !== a) eitherCounts[b] = (eitherCounts[b] || 0) + 1;
}
const rosterCounts = {};
for (const c of g.cities) rosterCounts[c.country] = (rosterCounts[c.country] || 0) + 1;

console.log(`\n=== country distribution, ${pack.puzzles.length} shipped puzzles vs. the roster ===`);
console.log('country  roster-share  puzzle-appearance-share  ratio');
const countries = Object.keys(rosterCounts).sort((x, y) => rosterCounts[y] - rosterCounts[x]);
for (const c of countries) {
  const rosterShare = rosterCounts[c] / g.n;
  const puzzleShare = (eitherCounts[c] || 0) / (pack.puzzles.length * 2);
  const ratio = puzzleShare / rosterShare;
  console.log(`${c.padEnd(8)} ${(rosterShare * 100).toFixed(1).padStart(5)}%      `
    + `${(puzzleShare * 100).toFixed(1).padStart(5)}%                  ${ratio.toFixed(2)}x`);
}
