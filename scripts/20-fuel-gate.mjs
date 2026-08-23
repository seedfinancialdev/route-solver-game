// Does fuel change which corridor wins?
//
// This is the first section-C gate and the first real test of the whole
// premise. Measured 2026-08-22: the naive fastest route was identical to the
// game-optimal route on 100% of the shipped puzzle set, because the only
// system that existed scaled with time alone and a uniform tax cannot move an
// argmin. If fuel does the same, the game is still solvable from a second
// browser tab.
//
// Fuel should be different, because it is coupled to place: it matters where
// the stations are, and a motorway services costs a fraction of what a town
// station costs. A corridor that is fast but poorly served can lose.
//
// Range is swept rather than fixed. A vehicle with 1,200 km of aux tanks barely
// stops; one with 500 km stops constantly. The interesting number is the range
// at which the ranking flips — that is the tuning knob for the whole system.
//
// Usage: npm run fuel:gate

import { readFileSync } from 'node:fs';
import { loadGraph, nearestNode, corridors } from './lib/road-graph.mjs';
import { loadStations, planFuel, KIND } from './lib/fuel.mjs';

const RANGES_KM = [1200, 900, 700, 550, 450, 350];

const g = loadGraph('data/road-graph');
const stations = loadStations('data/fuel.json');
const runs = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs
  .filter((r) => r.style !== 'circuit');   // a circuit's decision is sequencing

console.log(`${stations.count.toLocaleString()} stations, `
  + `${g.e.toLocaleString()} edges\n`);

const hm = (m) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;
let anyFlip = false;

for (const r of runs) {
  const a = nearestNode(g, r.from.lon, r.from.lat);
  const b = nearestNode(g, r.to.lon, r.to.lat);
  const cs = corridors(g, a, b, { tolerance: 1.20, rounds: 12 });
  console.log(`${r.name} — ${cs.length} corridors, driving time only:`);
  cs.forEach((c, i) => console.log(`   ${i}: ${c.km.toFixed(0).padStart(5)} km  ${hm(c.minutes)}`
    + `${i ? `  +${(100 * (c.minutes / cs[0].minutes - 1)).toFixed(1)}%` : '   <- fastest'}`));

  console.log('\n   range   corridor totals with fuel                          winner');
  for (const range of RANGES_KM) {
    const priced = cs.map((c, i) => {
      const f = planFuel(g, c.edges, stations, range);
      return {
        i,
        ok: f.ok,
        total: c.minutes + f.extraMinutes,
        stops: f.stops.length,
        services: f.stops.filter((s) => s.kind === KIND.SERVICES).length,
        extra: f.extraMinutes,
        dryAtKm: f.dryAtKm,
      };
    });
    const feasible = priced.filter((p) => p.ok);
    if (!feasible.length) {
      console.log(`   ${String(range).padStart(4)} km  every corridor runs dry`);
      continue;
    }
    const winner = feasible.reduce((x, y) => (y.total < x.total ? y : x));
    const flipped = winner.i !== 0;
    if (flipped) anyFlip = true;

    const cells = priced.map((p) => (p.ok
      ? `${hm(p.total)} (${p.stops}s${p.services ? `/${p.services}sv` : ''})`
      : `dry@${p.dryAtKm.toFixed(0)}km`)).map((s) => s.padEnd(18)).join('');
    console.log(`   ${String(range).padStart(4)} km  ${cells}  ${flipped ? `corridor ${winner.i}  <-- FLIP` : 'corridor 0'}`);
  }
  console.log();
}

console.log(anyFlip
  ? 'Fuel reorders corridors at some range: the system is route-coupled.'
  : 'Fuel never changes the winner. It is a cost, not a decision — the fastest\n'
    + 'route stays the right route, and a second browser tab still solves this.');
