// Does enforcement exposure differ between corridors?
//
// This is the last candidate. Driving hours and fuel both came back inert for
// the same structural reason: their cost was proportional to distance, and a
// uniform tax cannot move an argmin. Enforcement is the only system whose cost
// varies with PLACE — a corridor through thirty villages carries a completely
// different exposure from a motorway corridor of the same length.
//
// Measured here without importing anything new. The strongest free signal is
// the SPEED-LIMIT TRANSITION: police enforce where the limit drops, because
// that is where drivers are speeding without meaning to. The 100-to-50 at a
// village entry is the classic trap. A motorway corridor has almost none of
// them; a primary road through villages is made of them.
//
// If that does not vary between corridors, cameras and jurisdiction multipliers
// will not rescue enforcement either, and we would know before importing them.
//
// Reported per 100 km, because raw counts would just restate route length —
// the same mistake that made the first fuel measurement useless.
//
// Usage: npm run enforce:exposure

import { readFileSync } from 'node:fs';
import { loadGraph, nearestNode, corridors } from '../../scripts/lib/road-graph.mjs';

// A drop worth enforcing. Below this it is a rounding difference between two
// stretches of the same road, not a trap.
const DROP_KMH = 20;

const g = loadGraph('data/road-graph');
const CLS = g.meta.classes;
const runs = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs
  .filter((r) => r.style !== 'circuit');

const URBAN = new Set(['residential', 'living_street', 'unclassified']
  .map((c) => CLS.indexOf(c)).filter((i) => i >= 0));

/**
 * Walk a corridor counting the places enforcement would plausibly sit.
 *
 * Three signals, all free:
 *   drops        the limit falls by DROP_KMH or more between consecutive edges
 *   urbanKm      distance on roads that run through where people live
 *   slowKm       distance under 60 km/h, where a limit is low enough to catch
 */
function exposure(edges) {
  let drops = 0, urbanM = 0, slowM = 0, totalM = 0;
  let prevKmh = null;
  const dropsAt = [];

  for (const e of edges) {
    const kmh = g.kmh[e];
    const m = g.m[e];
    totalM += m;
    if (URBAN.has(g.cls[e])) urbanM += m;
    if (kmh < 60) slowM += m;
    if (prevKmh !== null && prevKmh - kmh >= DROP_KMH) {
      drops++;
      dropsAt.push(`${prevKmh}->${kmh}`);
    }
    prevKmh = kmh;
  }
  const per100 = (v) => (v / (totalM / 100000));
  return {
    km: totalM / 1000,
    dropsPer100km: per100(drops),
    urbanShare: urbanM / totalM,
    slowShare: slowM / totalM,
    drops,
  };
}

let anyVaries = false;

for (const r of runs) {
  const a = nearestNode(g, r.from.lon, r.from.lat);
  const b = nearestNode(g, r.to.lon, r.to.lat);
  const cs = corridors(g, a, b, { tolerance: 1.20, rounds: 12 });

  console.log(`${r.name} — ${cs.length} corridors`);
  console.log('   corridor      km   limit drops/100km   urban share   under-60 share');
  const rows = cs.map((c) => exposure(c.edges));
  rows.forEach((x, i) => {
    console.log(`     ${i}  ${x.km.toFixed(0).padStart(6)}  `
      + `${x.dropsPer100km.toFixed(1).padStart(16)}  `
      + `${(100 * x.urbanShare).toFixed(1).padStart(11)}%  `
      + `${(100 * x.slowShare).toFixed(1).padStart(13)}%`);
  });

  if (rows.length >= 2) {
    const spread = (f) => {
      const v = rows.map(f);
      const lo = Math.min(...v), hi = Math.max(...v);
      return { lo, hi, ratio: lo > 0 ? hi / lo : Infinity };
    };
    const d = spread((x) => x.dropsPer100km);
    const u = spread((x) => x.urbanShare);
    const s = spread((x) => x.slowShare);
    console.log(`\n   limit drops per 100km: ${d.lo.toFixed(1)}-${d.hi.toFixed(1)}  (${d.ratio.toFixed(2)}x)`);
    console.log(`   urban share:           ${(100 * u.lo).toFixed(1)}-${(100 * u.hi).toFixed(1)}%  (${u.ratio.toFixed(2)}x)`);
    console.log(`   under-60 share:        ${(100 * s.lo).toFixed(1)}-${(100 * s.hi).toFixed(1)}%  (${s.ratio.toFixed(2)}x)`);
    const varies = d.ratio > 1.5 || u.ratio > 1.5 || s.ratio > 1.5;
    if (varies) anyVaries = true;
    console.log(varies
      ? '   -> exposure DIFFERS materially between corridors.'
      : '   -> exposure is similar. Enforcement would be another uniform tax.');
  }
  console.log();
}

console.log(anyVaries
  ? 'Enforcement varies by place, as hoped. Worth importing cameras and\n'
    + 'jurisdiction intensity and testing whether it reorders corridors.'
  : 'Enforcement exposure does not vary between corridors on these runs.\n'
    + 'Importing cameras would not change that — the corridors are made of the\n'
    + 'same kind of road.');
