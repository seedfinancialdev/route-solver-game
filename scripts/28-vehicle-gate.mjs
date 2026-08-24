// Does the car you bring change which plan wins?
//
// Seven of nine systems have come back inert, all the same way: their cost
// tracked the road hierarchy, and in a race the motorway wins on every axis at
// once. Fuel range was the last one with a plausible mechanism and it moved
// nothing — the same plan wins from 350 km of range to 1,000.
//
// That leaves the car itself, and one attribute of it has a mechanism none of
// the inert systems had. Europe has 19,029 km of DERESTRICTED autobahn — 12.4%
// of all motorway — and it is not spread across the network. It is in Germany:
// the Rhine-Ruhr, Frankfurt, Munich. On every other road a fast car and a slow
// one both drive the limit. On those 19,029 km they do not.
//
// So car top speed is coupled to PLACE rather than to road class, which is the
// property every inert system lacked. A plan through Germany can spend a fast
// car; a plan through Italy and the Balkans cannot.
//
// Measured free-flow, which is licensed here rather than lazy: the free-flow
// order is the traffic order on 233 of 247 races.
//
// Note on the data: the graph flattens derestricted autobahn to 150 km/h, so
// this detects it as (motorway AND 150 AND real maxspeed) and treats it as
// uncapped. 150 is not a posted limit anywhere in the covered countries, and
// every dense cell of it is in Germany. If the result is positive, the graph
// should carry a derestricted flag rather than a magic number.
//
// Usage: npm run vehicle:gate

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadGraph, junctionNode, route, corridors } from './lib/road-graph.mjs';
import { loadRace } from './lib/race.mjs';

const CACHE = 'data/vehicle-legs.json';
const PICK = 4;

// Sustained cruising speed, not showroom top speed — what a driver holds on an
// empty autobahn for an hour, which is well under the number on the brochure.
const CARS = [
  { name: 'diesel estate', kmh: 150 },
  { name: 'hot hatch', kmh: 180 },
  { name: 'fast saloon', kmh: 220 },
  { name: 'supercar', kmh: 260 },
];

const { race, stops, candidates, signature } = loadRace(process.env.RACE || 'grand-tour-menu');
const N = stops.length;
const hm = (m) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;
const pct = (x) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}%`;

console.log(`${race.name}: ${stops[0].name} -> ${stops[N - 1].name}, pick ${PICK} of ${candidates.length}\n`);

// ---- per-leg time for each car --------------------------------------------
let legs;
const cached = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : null;
if (cached && cached.signature === signature && cached.cars === CARS.map((c) => c.kmh).join()) {
  legs = cached.legs;
  console.log(`  leg times from cache (${CACHE}, built ${cached.built})\n`);
} else {
  const g = loadGraph('data/road-graph');
  const REAL = g.meta.flags.maxspeedReal;
  const MOTORWAY = g.meta.classes.indexOf('motorway');
  const derestricted = (e) => g.cls[e] === MOTORWAY && g.kmh[e] === 150 && (g.flags[e] & REAL);
  const nodes = stops.map((s) => junctionNode(g, s.lon, s.lat));

  legs = Array.from({ length: N }, () => new Array(N).fill(null));
  const pairs = [];
  for (let i = 0; i < N - 1; i++) for (let j = 1; j < N; j++) if (i !== j) pairs.push([i, j]);
  let done = 0;
  for (const [i, j] of pairs) {
    const r = route(g, nodes[i], nodes[j]);
    if (r) {
      // On a posted limit every car drives the limit. Only where there is no
      // limit does the car matter.
      const minutes = CARS.map(() => 0);
      let freeM = 0;
      for (const e of r.edges) {
        const km = g.m[e] / 1000;
        if (derestricted(e)) freeM += g.m[e];
        for (let c = 0; c < CARS.length; c++) {
          const kmh = derestricted(e) ? CARS[c].kmh : Math.min(g.kmh[e], CARS[c].kmh);
          minutes[c] += (km / kmh) * 60;
        }
      }
      legs[i][j] = {
        km: Number(r.km.toFixed(1)),
        freeKm: Number((freeM / 1000).toFixed(1)),
        minutes: minutes.map((m) => Number(m.toFixed(2))),
      };
    }
    process.stdout.write(`\r  routing ${++done}/${pairs.length} legs`);
  }
  console.log();
  writeFileSync(CACHE, JSON.stringify({
    built: new Date().toISOString().slice(0, 10), signature,
    cars: CARS.map((c) => c.kmh).join(), legs,
  }));
}

function permutations(items) {
  if (items.length <= 1) return [items];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const p of permutations(rest)) out.push([items[i], ...p]);
  }
  return out;
}
function subsetsOfSize(items, k) {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...tail] = items;
  return [...subsetsOfSize(tail, k - 1).map((s) => [head, ...s]), ...subsetsOfSize(tail, k)];
}

// ---- every plan, priced for every car -------------------------------------
const ids = candidates.map((_, i) => i + 1);
const plans = [];
for (const set of subsetsOfSize(ids, PICK)) {
  for (const p of permutations(set)) {
    const order = [0, ...p, N - 1];
    let km = 0, freeKm = 0;
    const minutes = CARS.map(() => 0);
    let ok = true;
    for (let k = 1; k < order.length; k++) {
      const l = legs[order[k - 1]][order[k]];
      if (!l) { ok = false; break; }
      km += l.km; freeKm += l.freeKm;
      for (let c = 0; c < CARS.length; c++) minutes[c] += l.minutes[c];
    }
    if (ok) plans.push({ order, km, freeKm, minutes });
  }
}
const label = (o) => o.slice(1, -1).map((i) => stops[i].name).join(' -> ');
console.log(`  ${plans.length} plans\n`);

console.log('  car                    best plan                                total   derestricted km   vs slowest car');
const winners = new Map();
const slowest = plans.reduce((a, b) => (b.minutes[0] < a.minutes[0] ? b : a));
for (let c = 0; c < CARS.length; c++) {
  const best = plans.reduce((a, b) => (b.minutes[c] < a.minutes[c] ? b : a));
  winners.set(label(best.order), (winners.get(label(best.order)) || 0) + 1);
  const gain = slowest.minutes[c] - best.minutes[c];
  console.log(`  ${(`${CARS[c].name} (${CARS[c].kmh})`).padEnd(22)} ${label(best.order).padEnd(40)} `
    + `${hm(best.minutes[c]).padStart(6)}   ${best.freeKm.toFixed(0).padStart(15)}   `
    + `${gain > 0.5 ? `saves ${hm(gain)} by re-planning` : 'same plan'}`);
}

// ---- the mechanism --------------------------------------------------------
const free = plans.map((p) => p.freeKm).sort((a, b) => a - b);
console.log(`\n  Derestricted autobahn per plan: ${free[0].toFixed(0)}-${free[free.length - 1].toFixed(0)} km`
  + `  (${(free[free.length - 1] / Math.max(1, free[0])).toFixed(1)}x spread)`);

const fastOnSlowPlan = plans.find((p) => p.order.join() === slowest.order.join());
const fastBest = plans.reduce((a, b) => (b.minutes[CARS.length - 1] < a.minutes[CARS.length - 1] ? b : a));
console.log(`  A ${CARS[CARS.length - 1].kmh} km/h car on the slow car's plan: ${hm(fastOnSlowPlan.minutes[CARS.length - 1])}`);
console.log(`  A ${CARS[CARS.length - 1].kmh} km/h car on its OWN best plan:   ${hm(fastBest.minutes[CARS.length - 1])}`
  + `  (${pct(fastOnSlowPlan.minutes[CARS.length - 1] / fastBest.minutes[CARS.length - 1] - 1)})`);

// A 3,000 km spread in derestricted autobahn that changes nothing needs an
// explanation, not just a verdict. These are the plans that carry the most
// unlimited road, and what they cost.
const byFree = [...plans].sort((a, b) => b.freeKm - a.freeKm).slice(0, 5);
console.log('\n  The plans with the most derestricted road:');
console.log('    derestricted   distance   at 150     at 260   gain    behind the winner at 260');
const bestFast = Math.min(...plans.map((p) => p.minutes[CARS.length - 1]));
for (const p of byFree) {
  console.log(`    ${p.freeKm.toFixed(0).padStart(9)} km   ${p.km.toFixed(0).padStart(6)} km   `
    + `${hm(p.minutes[0]).padStart(6)}   ${hm(p.minutes[CARS.length - 1]).padStart(6)}   `
    + `${hm(p.minutes[0] - p.minutes[CARS.length - 1]).padStart(5)}   `
    + `${hm(p.minutes[CARS.length - 1] - bestFast).padStart(6)}   ${label(p.order)}`);
}

// Does a fast car reshuffle the field at all, even without changing the winner?
const rankSlow = new Map([...plans].sort((a, b) => a.minutes[0] - b.minutes[0]).map((p, i) => [p.order.join(), i]));
const rankFast = [...plans].sort((a, b) => a.minutes[CARS.length - 1] - b.minutes[CARS.length - 1]);
let moved = 0, biggest = 0, biggestPlan = null;
rankFast.forEach((p, i) => {
  const d = rankSlow.get(p.order.join()) - i;
  if (d !== 0) moved++;
  if (Math.abs(d) > Math.abs(biggest)) { biggest = d; biggestPlan = p; }
});
console.log(`\n  A fast car reshuffles ${moved} of ${plans.length} plans in the ranking.`);
console.log(`  Biggest move: ${biggest > 0 ? 'up' : 'down'} ${Math.abs(biggest)} places `
  + `(${label(biggestPlan.order)}, ${biggestPlan.freeKm.toFixed(0)} km derestricted)`);

console.log(winners.size > 1
  ? `\n${winners.size} different plans win for different cars. The car you bring changes the\n`
    + 'route you should take — the first vehicle attribute with a real decision in it.'
  : '\nEvery car wants the same plan. Car speed is worth time, but it is not a\n'
    + 'planning decision — it shifts every plan together.');


// ---- where the autobahn is actually optional -------------------------------
//
// On a Barcelona-to-Istanbul race the winning plan is always the cities nearest
// the direct line, so no comparable-distance alternative exists and the car has
// nothing to choose between. That is a property of the RACE, not of the car.
//
// The car can only matter where Germany is genuinely optional: a pair with two
// corridors of similar length, one of which runs on derestricted autobahn and
// one of which does not. These are those pairs.
if (process.env.SKIP_CORRIDORS) process.exit(0);

const PAIRS = [
  ['Milan', 9.1900, 45.4642, 'Amsterdam', 4.9041, 52.3676],
  ['Milan', 9.1900, 45.4642, 'Hamburg', 9.9937, 53.5511],
  ['Zagreb', 15.9819, 45.8150, 'Amsterdam', 4.9041, 52.3676],
  ['Vienna', 16.3738, 48.2082, 'Brussels', 4.3517, 50.8503],
  ['Barcelona', 2.1686, 41.3874, 'Copenhagen', 12.5683, 55.6761],
];

console.log('\n\n  ---- where the autobahn is optional ----\n');
const g2 = loadGraph('data/road-graph');
const REAL2 = g2.meta.flags.maxspeedReal;
const MW2 = g2.meta.classes.indexOf('motorway');
const isFree = (e) => g2.cls[e] === MW2 && g2.kmh[e] === 150 && (g2.flags[e] & REAL2);

let anyFlip = false;
for (const [an, alo, ala, bn, blo, bla] of PAIRS) {
  const a = junctionNode(g2, alo, ala), b = junctionNode(g2, blo, bla);
  const cs = corridors(g2, a, b, { tolerance: 1.20, rounds: 12 });
  const rows = cs.map((c) => {
    let freeM = 0;
    const minutes = CARS.map(() => 0);
    for (const e of c.edges) {
      if (isFree(e)) freeM += g2.m[e];
      const km = g2.m[e] / 1000;
      for (let i = 0; i < CARS.length; i++) {
        minutes[i] += (km / (isFree(e) ? CARS[i].kmh : Math.min(g2.kmh[e], CARS[i].kmh))) * 60;
      }
    }
    return { km: c.km, freeKm: freeM / 1000, minutes };
  });

  const winnerFor = (i) => rows.reduce((best, r, j) => (r.minutes[i] < rows[best].minutes[i] ? j : best), 0);
  const first = winnerFor(0), last = winnerFor(CARS.length - 1);
  if (first !== last) anyFlip = true;

  console.log(`  ${an} -> ${bn}: ${cs.length} corridors`);
  rows.forEach((r, j) => console.log(`    ${j}: ${r.km.toFixed(0).padStart(5)} km, `
    + `${r.freeKm.toFixed(0).padStart(4)} km derestricted   `
    + CARS.map((c, i) => `${c.kmh}: ${hm(r.minutes[i])}`).join('   ')));
  console.log(first !== last
    ? `    -> the ${CARS[0].kmh} car wants corridor ${first}, the ${CARS[CARS.length - 1].kmh} car wants ${last}.  <-- FLIP\n`
    : `    -> every car wants corridor ${first}\n`);
}
console.log(anyFlip
  ? 'Where two corridors are comparable and one is derestricted, the car changes\nthe route. Vehicles are a routing decision on those pairs.'
  : 'Even where the autobahn is optional, every car takes the same corridor.');
