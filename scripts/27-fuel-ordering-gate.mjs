// Does fuel range change which plan wins?
//
// Six systems have been measured against "does it change the answer" and one
// passed. Traffic in particular did not: the free-flow-optimal order is the
// traffic-optimal order on 233 of 247 races. That result is what makes it safe
// — or unsafe — to show a player Google's numbers, because if free-flow times
// determine the plan then distance and drive time ARE the answer.
//
// Fuel is the one input that could break it, and for a specific reason rather
// than a hopeful one. Priced as a cost per stop, fuel was inert: stops scale
// with distance, distance scales with time, and a uniform tax cannot move an
// argmin. But priced as a RANGE it is not a tax at all — it is a constraint
// that binds on some routes and not others. The worst services-only gap
// measured 383, 450 and 738 km on three corridors of the same run.
//
// Which legs you drive depends on which cities you pick and in what order. So
// unlike traffic, fuel range has a route to changing the plan.
//
// The tank carries across checkpoints, so this prices a whole ordering rather
// than each leg on its own — a leg that ends with a full tank is a different
// leg from one that ends nearly dry.
//
// Usage: npm run fuel:ordering        (needs npm run order:count first)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadGraph, junctionNode, route } from './lib/road-graph.mjs';
import { loadRace } from './lib/race.mjs';
import { loadStations, bestNear, KIND } from './lib/fuel.mjs';

const MATRIX = 'data/checkpoint-matrix.json';
const PROFILES = 'data/fuel-profiles.json';
const DEPART_HOUR = Number(process.argv[2] ?? 6);
const RANGES_KM = [350, 450, 550, 700, 1000];
const PICK = 4;

const { race, stops, candidates, signature } = loadRace(process.env.RACE || 'grand-tour-menu');
const N = stops.length;
const pct = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}%` : '  n/a');
const hm = (m) => (Number.isFinite(m) ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}` : 'dry');

// ---- the timed cost matrix, built by the ordering gate ---------------------
if (!existsSync(MATRIX)) throw new Error(`no ${MATRIX} — run "npm run order:count" first`);
const cache = JSON.parse(readFileSync(MATRIX, 'utf8'));
if (cache.signature !== signature) throw new Error(`${MATRIX} is for a different race — rerun "npm run order:count"`);
const BUCKETS = cache.buckets;
const timed = cache.timed.map((r) => r.map((c) => c.map((v) => (v === null ? Infinity : v))));

console.log(`${race.name}: ${stops[0].name} -> ${stops[N - 1].name}, `
  + `pick ${PICK} of ${candidates.length}, departing ${String(DEPART_HOUR).padStart(2, '0')}:00\n`);

// ---- fuel profiles per ordered pair ---------------------------------------
// A profile is where fuel sits along the leg and what stopping there costs,
// sampled to one entry per kilometre. That is small enough to cache and it is
// all the range planner needs, so re-running at a different range is instant.
let profiles;
const cachedProfiles = existsSync(PROFILES) ? JSON.parse(readFileSync(PROFILES, 'utf8')) : null;
if (cachedProfiles && cachedProfiles.signature === signature) {
  profiles = cachedProfiles.profiles;
  console.log(`  fuel profiles from cache (${PROFILES}, built ${cachedProfiles.built})\n`);
} else {
  const g = loadGraph('data/road-graph');
  const stations = loadStations('data/fuel.json');
  console.log(`  ${stations.count.toLocaleString()} stations`);
  const nodes = stops.map((s) => junctionNode(g, s.lon, s.lat));
  profiles = Array.from({ length: N }, () => new Array(N).fill(null));
  const pairs = [];
  for (let i = 0; i < N - 1; i++) for (let j = 1; j < N; j++) if (i !== j) pairs.push([i, j]);
  let done = 0;
  for (const [i, j] of pairs) {
    const r = route(g, nodes[i], nodes[j]);
    if (r) {
      // Look from the far end of each edge: that is where the driver is when
      // the decision to divert has to be made.
      // Two profiles per leg. "stations" lets the driver divert up to 4 km for
      // a town pump and prices the diversion; "services" is a racer who will
      // not leave the motorway at all, which is the model the station-spacing
      // measurement was actually about.
      const anyFuel = [], services = [];
      let travelled = 0, bucketAny = -1, bucketSrv = -1;
      const push = (list, bucket, km, s) => {
        const kb = Math.floor(km);
        if (kb === bucket && list.length) {
          if (s.cost < list[list.length - 1][1]) list[list.length - 1] = [Number(km.toFixed(2)), Number(s.cost.toFixed(2))];
          return bucket;
        }
        list.push([Number(km.toFixed(2)), Number(s.cost.toFixed(2))]);
        return kb;
      };
      for (const e of r.edges) {
        travelled += g.m[e];
        const b = g.b[e], lon = g.xy[2 * b], lat = g.xy[2 * b + 1], km = travelled / 1000;
        const a = bestNear(stations, lon, lat);
        if (a) bucketAny = push(anyFuel, bucketAny, km, a);
        const v = bestNear(stations, lon, lat, undefined, KIND.SERVICES);
        if (v) bucketSrv = push(services, bucketSrv, km, v);
      }
      profiles[i][j] = { km: Number(r.km.toFixed(1)), stations: anyFuel, services };
    }
    process.stdout.write(`\r  fuel profiles ${++done}/${pairs.length} legs`);
  }
  console.log();
  writeFileSync(PROFILES, JSON.stringify({ built: new Date().toISOString().slice(0, 10), signature, profiles }));
}

/**
 * Minutes lost to refuelling over a whole route, greedy-latest.
 *
 * Run the tank down and stop at the last station still in reach. Not optimal —
 * an earlier services can beat a later town station — but it is the same
 * baseline for every plan, which is what a comparison needs.
 */
function fuelMinutes(sites, totalKm, rangeKm) {
  let at = 0, extra = 0, i = 0;
  while (totalKm - at > rangeKm) {
    let pick = -1;
    while (i < sites.length && sites[i][0] <= at + rangeKm) { if (sites[i][0] > at) pick = i; i++; }
    if (pick < 0) return Infinity;                       // ran dry with nowhere to stop
    extra += sites[pick][1];
    at = sites[pick][0];
    i = pick + 1;
  }
  return extra;
}

/** Merge the legs of an ordering into one continuous route. */
function wholeRoute(order, which) {
  const sites = [];
  let km = 0;
  for (let k = 1; k < order.length; k++) {
    const p = profiles[order[k - 1]][order[k]];
    if (!p) return null;
    for (const [d, c] of p[which]) sites.push([km + d, c]);
    km += p.km;
  }
  return { sites, km };
}

function leg(i, j, clock) {
  const h = ((clock % 1440) + 1440) % 1440 / (1440 / BUCKETS);
  const b0 = Math.floor(h) % BUCKETS, b1 = (b0 + 1) % BUCKETS, f = h - Math.floor(h);
  return timed[i][j][b0] * (1 - f) + timed[i][j][b1] * f;
}

/** Driving minutes for an ordering, with the clock running through it. */
function driveMinutes(order, departMinutes) {
  let clock = departMinutes, sum = 0;
  for (let k = 1; k < order.length; k++) {
    const t = leg(order[k - 1], order[k], clock);
    if (!Number.isFinite(t)) return Infinity;
    sum += t; clock += t;
  }
  return sum;
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

// ---- every plan: which k to visit, in what order ---------------------------
const depart = DEPART_HOUR * 60;
const ids = candidates.map((_, i) => i + 1);
const plans = [];
for (const set of subsetsOfSize(ids, PICK)) {
  for (const p of permutations(set)) {
    const order = [0, ...p, N - 1];
    const drive = driveMinutes(order, depart);
    const any = wholeRoute(order, 'stations');
    const srv = wholeRoute(order, 'services');
    if (!Number.isFinite(drive) || !any) continue;
    plans.push({ order, drive, km: any.km, sites: { stations: any.sites, services: srv ? srv.sites : [] } });
  }
}
const setCount = subsetsOfSize(ids, PICK).length;
console.log(`  ${plans.length} plans (${setCount} sets x ${plans.length / setCount} orders)\n`);

const label = (o) => o.slice(1, -1).map((i) => stops[i].name).join(' -> ');
const blind = plans.reduce((a, b) => (b.drive < a.drive ? b : a));   // the plan Google's numbers give you
console.log(`  Ignoring fuel entirely, the best plan is ${label(blind.order)}`);
console.log(`  at ${hm(blind.drive)} over ${blind.km.toFixed(0)} km.\n`);

let reordered = false;

for (const which of ['stations', 'services']) {
  console.log(which === 'stations'
    ? '  ANY FUEL — the driver will divert up to 4 km for a town pump, and pays for it'
    : '\n  SERVICES ONLY — the driver never leaves the motorway');
  console.log('  range   best plan with fuel                               total    fuel   ignoring fuel   undrivable');

  for (const rangeKm of RANGES_KM) {
    const priced = plans.map((p) => {
      const f = fuelMinutes(p.sites[which], p.km, rangeKm);
      return { ...p, fuel: f, total: p.drive + f };
    });
    const drivable = priced.filter((p) => Number.isFinite(p.total));
    const dry = priced.length - drivable.length;
    if (!drivable.length) {
      console.log(`  ${String(rangeKm).padStart(5)} km  no plan is drivable at this range`
        + `${''.padEnd(56)}${dry}/${priced.length}`);
      continue;
    }
    const best = drivable.reduce((a, b) => (b.total < a.total ? b : a));
    const blindPriced = drivable.find((p) => p.order.join() === blind.order.join());
    const penalty = blindPriced ? blindPriced.total / best.total - 1 : Infinity;
    const changed = best.order.join() !== blind.order.join();
    if (changed) reordered = true;
    console.log(`  ${String(rangeKm).padStart(5)} km  ${label(best.order).padEnd(45)} `
      + `${hm(best.total).padStart(6)}  ${hm(best.fuel).padStart(5)}  ${pct(penalty).padStart(12)}   `
      + `${String(dry).padStart(4)}/${priced.length}`
      + `${changed ? '  <-- DIFFERENT PLAN WINS' : ''}`);
  }
}

// ---- is the fuel cost a place effect or a distance tax? --------------------
console.log('\n  Is fuel a place effect or a distance tax?');
for (const which of ['stations', 'services']) {
  const per1000 = plans.map((p) => {
    const f = fuelMinutes(p.sites[which], p.km, 450);
    return Number.isFinite(f) ? (1000 * f) / p.km : null;
  }).filter((x) => x !== null).sort((a, b) => a - b);
  if (!per1000.length) { console.log(`    ${which}: no plan drivable at 450 km`); continue; }
  const lo = per1000[0], hi = per1000[per1000.length - 1];
  console.log(`    ${which.padEnd(9)} at 450 km range: ${lo.toFixed(1)}-${hi.toFixed(1)} fuel minutes per 1000 km`
    + `  (${(hi / lo).toFixed(2)}x spread)`);
}

console.log(reordered
  ? '\nFuel range changes which plan wins. Distance and free-flow time are NOT the answer.'
  : '\nFuel range never changes which plan wins. It scales with distance, and the\n'
    + 'shortest plan is both the fastest and the cheapest to fuel — the same\n'
    + 'reinforcing failure as enforcement exposure.');
