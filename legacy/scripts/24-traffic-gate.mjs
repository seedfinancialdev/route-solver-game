// Does departure time change which corridor wins?
//
// This is the question the whole design rests on. Three systems have already
// come back inert — driving hours, fuel, enforcement exposure — because each
// one is correlated with the road hierarchy, and in a cannonball the motorway
// wins on every axis at once. All three were also measured on a graph with no
// time in it.
//
// Traffic is the first system that attacks the FAST road specifically: a
// motorway through a metro at 08:00 is worse than the bypass, and nothing
// slower is hurt the same way. If a corridor ranking ever reverses, it reverses
// here.
//
// Two things get measured:
//   1. does the winner change with departure time
//   2. how much departure time is worth at all, which is the "leave at 03:00"
//      strategy priced
//
// Usage: npm run traffic:gate

import { readFileSync } from 'node:fs';
import { loadGraph, nearestNode, corridors, routeTimed, travelMinutes } from '../../scripts/lib/road-graph.mjs';
import { buildUrbanField, throughClasses, congestion, urbanness } from './lib/traffic.mjs';

const DEPARTURES = [0, 3, 6, 9, 12, 15, 18, 21];

const g = loadGraph('data/road-graph');
let t = Date.now();
const urban = buildUrbanField(g);
const through = throughClasses(g);
console.log(`urban field: ${urban.field.size.toLocaleString()} populated cells `
  + `in ${((Date.now() - t) / 1000).toFixed(1)}s\n`);

const cost = (edge, clock) => travelMinutes(g, edge) * congestion(g, urban, through, edge, clock);
const hm = (m) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;

const runs = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs
  .filter((r) => r.style !== 'circuit');

let anyFlip = false;

for (const r of runs) {
  const a = nearestNode(g, r.from.lon, r.from.lat);
  const b = nearestNode(g, r.to.lon, r.to.lat);

  // The corridor set comes from the free-flow world, so every departure is
  // scored against the same candidates and a flip means the ranking moved,
  // not that the search found something different.
  const cs = corridors(g, a, b, { tolerance: 1.20, rounds: 12 });
  console.log(`${r.name} — ${cs.length} corridors`);
  cs.forEach((c, i) => {
    const u = c.edges.reduce((s, e) => s + urbanness(urban, g.xy[2 * g.a[e]], g.xy[2 * g.a[e] + 1]) * g.m[e], 0)
      / c.edges.reduce((s, e) => s + g.m[e], 0);
    console.log(`   ${i}: ${c.km.toFixed(0).padStart(5)} km  free-flow ${hm(c.minutes)}  `
      + `mean urbanness ${(100 * u).toFixed(1)}%`);
  });

  console.log('\n   depart    ' + cs.map((_, i) => `corridor ${i}`.padEnd(12)).join('') + ' winner');
  const totals = [];
  for (const hour of DEPARTURES) {
    const depart = hour * 60;
    const timed = cs.map((c) => {
      // Re-cost the SAME corridor under traffic rather than re-routing, so the
      // comparison is between the candidates the player is choosing among.
      let minutes = 0;
      for (const e of c.edges) minutes += cost(e, depart + minutes);
      return minutes;
    });
    const winner = timed.indexOf(Math.min(...timed));
    if (winner !== 0) anyFlip = true;
    totals.push(timed);
    console.log(`   ${String(hour).padStart(2, '0')}:00     `
      + timed.map((m) => hm(m).padEnd(12)).join('')
      + ` ${winner}${winner !== 0 ? '  <-- FLIP' : ''}`);
  }

  const best = Math.min(...totals.map((row) => Math.min(...row)));
  const worst = Math.max(...totals.map((row) => Math.min(...row)));
  console.log(`\n   best departure beats worst by ${hm(worst - best)} `
    + `(${(100 * (worst / best - 1)).toFixed(1)}%)`);
  console.log();
}

console.log(anyFlip
  ? 'Departure time reorders corridors. Route planning has a real decision in it.'
  : 'Departure time never changes the winner. It shifts every corridor together,\n'
    + 'so it is a departure decision but not a routing one.');
