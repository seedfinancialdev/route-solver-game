// Does station spacing differ between corridors?
//
// This is the question underneath the whole fuel system, and it needs no car
// model, no pump rate and no weight feedback to answer.
//
// The first fuel gate came back negative, but it tested a crude model: a fixed
// cost per stop, always fill to full, range as one number. Under that model
// fuel cost is roughly distance / range x constant, which is proportional to
// distance and therefore to time — another uniform tax, which cannot move an
// argmin.
//
// A real fuel system is not that. Stop time is overhead plus litres pumped;
// fill amount is a decision that depends on where the NEXT station is; carrying
// fuel costs weight. Every one of those effects is driven by the same
// underlying property: how far apart the stations are along the corridor you
// chose.
//
// So: if spacing is the same on every corridor, no car model can make fuel
// route-coupled and none of it is worth building. If spacing differs sharply,
// the mechanic has somewhere to live.
//
// Usage: npm run fuel:spacing

import { readFileSync } from 'node:fs';
import { loadGraph, nearestNode, corridors } from '../../scripts/lib/road-graph.mjs';
import { loadStations, bestNear, KIND, REACH_M } from './lib/fuel.mjs';

const g = loadGraph('data/road-graph');
const stations = loadStations('data/fuel.json');
const runs = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs
  .filter((r) => r.style !== 'circuit');

console.log(`${stations.count.toLocaleString()} stations, ${g.e.toLocaleString()} edges\n`);

/**
 * Walk a corridor and record the distance between consecutive points where
 * fuel is reachable. Sampled every ~2 km rather than per edge: edges here are
 * junction-to-junction and can be a few hundred metres, so per-edge sampling
 * would count the same station many times over.
 */
function spacing(edges, servicesOnly = false) {
  const SAMPLE_M = 2000;
  const gaps = [];
  const kinds = { [KIND.FUEL]: 0, [KIND.SERVICES]: 0 };
  let travelled = 0, sinceSample = 0, lastFuelAt = 0, everFound = false;

  for (const e of edges) {
    travelled += g.m[e];
    sinceSample += g.m[e];
    if (sinceSample < SAMPLE_M) continue;
    sinceSample = 0;
    const nb = g.b[e];
    // servicesOnly asks the question a cannonball actually faces: can you fuel
    // WITHOUT leaving the road. A 4 km reach makes fuel ubiquitous in Europe;
    // service areas are the ones with no detour at all.
    const found = servicesOnly
      ? bestNear(stations, g.xy[2 * nb], g.xy[2 * nb + 1], 1200, KIND.SERVICES)
      : bestNear(stations, g.xy[2 * nb], g.xy[2 * nb + 1], REACH_M);
    if (!found) continue;
    kinds[found.kind]++;
    gaps.push((travelled - lastFuelAt) / 1000);
    lastFuelAt = travelled;
    everFound = true;
  }
  if (!everFound) return null;
  gaps.sort((a, b) => a - b);
  const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
  return {
    reachablePoints: gaps.length,
    median: q(0.5),
    p90: q(0.9),
    max: gaps[gaps.length - 1],
    servicesShare: kinds[KIND.SERVICES] / (kinds[KIND.SERVICES] + kinds[KIND.FUEL]),
  };
}

for (const r of runs) {
  const a = nearestNode(g, r.from.lon, r.from.lat);
  const b = nearestNode(g, r.to.lon, r.to.lat);
  const cs = corridors(g, a, b, { tolerance: 1.20, rounds: 12 });
  console.log(`${r.name} — ${cs.length} corridors`);
  console.log('   corridor      km   gap median    gap p90    worst gap   services share');

  const rows = [];
  for (const [i, c] of cs.entries()) {
    const s = spacing(c.edges);
    if (!s) { console.log(`     ${i}  no fuel reachable anywhere`); continue; }
    const sv = spacing(c.edges, true);
    rows.push({ ...s, services: sv });
    console.log(`     ${i}  ${c.km.toFixed(0).padStart(6)}  `
      + `${s.median.toFixed(1).padStart(9)} km  ${s.p90.toFixed(1).padStart(8)} km  `
      + `${s.max.toFixed(0).padStart(9)} km  ${(100 * s.servicesShare).toFixed(0).padStart(12)}%`);
    console.log(`        services only: median ${sv ? sv.median.toFixed(0) + ' km, p90 ' + sv.p90.toFixed(0) + ' km, worst ' + sv.max.toFixed(0) + ' km' : 'none on this corridor'}`);
  }

  if (rows.length >= 2) {
    // The verdict reads the SERVICES-ONLY column, not the all-fuel one. With a
    // 4 km reach and 124k stations, fuel is ubiquitous in Europe — median gap
    // 2.5 km — so the all-fuel column says "similar" everywhere and answers the
    // wrong question. What varies, and what a cannonball actually faces, is how
    // far you must travel with no service area: the range at which the corridor
    // FORCES you off the road.
    const all = rows.map((x) => x.max);
    const sv = rows.map((x) => (x.services ? x.services.max : Infinity));
    const lo = Math.min(...sv), hi = Math.max(...sv);
    console.log(`\n   all-fuel worst gap:      ${Math.min(...all).toFixed(0)}-${Math.max(...all).toFixed(0)} km  (fuel is everywhere; not the question)`);
    console.log(`   services-only worst gap: ${lo.toFixed(0)}-${hi.toFixed(0)} km  <- the range that forces you off the road`);
    console.log(hi / Math.max(1, lo) > 1.5
      ? `   -> DIFFERS by ${(hi / lo).toFixed(1)}x. Corridor choice depends on the car's range.`
      : '   -> similar. Range does not change which corridor you can run.');
  }
  console.log();
}
