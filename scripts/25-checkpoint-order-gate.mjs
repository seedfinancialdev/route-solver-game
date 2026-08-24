// Does the best checkpoint ORDER change with departure time?
//
// Four systems have come back inert on the "does it reorder corridors" test:
// driving hours, fuel, enforcement exposure, and traffic. All four failed the
// same way — in a cannonball the road hierarchy aligns everything, so the
// motorway corridor wins on every axis at once and nothing reverses it.
//
// This tests a different decision entirely. Checkpoints inside cities force
// urban penetration, which is where traffic actually bites: measured at 66% on
// an 86 km leg through the Randstad and 37% through the Milan corridor, against
// 1.5-3.8% for a whole 6,000 km run that could stay on the spine.
//
// The order you visit them in determines WHEN you arrive at each, and when you
// arrive determines what it costs. So order, departure time and traffic are one
// joint problem. If the best order at 06:00 differs from the best at 22:00,
// that is the first genuine reordering any system has produced.
//
// Checkpoints are pass-through, not stops. The clock never pauses; the entire
// cost of a checkpoint is getting in and out of the city.
//
// Usage: npm run order:gate

import { readFileSync } from 'node:fs';
import { loadGraph, junctionNode, timesFromTimed, travelMinutes } from './lib/road-graph.mjs';
import { buildUrbanField, throughClasses, congestion } from './lib/traffic.mjs';

const BUCKETS = 8;                         // 3-hour resolution on the cost matrix
const DEPARTURES = [0, 3, 6, 9, 12, 15, 18, 21];

const g = loadGraph('data/road-graph');
const urban = buildUrbanField(g);
const through = throughClasses(g);
const cost = (e, clock) => travelMinutes(g, e) * congestion(g, urban, through, e, clock);
const hm = (m) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;

const run = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs
  .find((r) => r.id === (process.argv[2] || 'grand-tour'));

const stops = [run.from, ...run.checkpoints, run.to];
const nodes = stops.map((p) => junctionNode(g, p.lon, p.lat));
console.log(`${run.name}: ${stops.map((s) => s.name).join(' / ')}`);
console.log(`checkpoints are pass-through; ${BUCKETS} time buckets on the cost matrix\n`);

// ---- time-dependent cost matrix ------------------------------------------
// One sweep answers every destination at once, so the matrix costs one search
// per (source, hour) rather than one per (source, destination, hour).
const N = stops.length;
const matrix = Array.from({ length: N }, () => Array.from({ length: N }, () => new Array(BUCKETS).fill(Infinity)));
let sweep = 0;
const total = (N - 1) * BUCKETS;                     // nothing ever leaves the finish
for (let i = 0; i < N - 1; i++) {
  for (let b = 0; b < BUCKETS; b++) {
    const d = timesFromTimed(g, nodes[i], (b * 24 / BUCKETS) * 60, cost);
    for (let j = 0; j < N; j++) matrix[i][j][b] = d[nodes[j]];
    process.stdout.write(`\r  matrix ${++sweep}/${total} sweeps`);
  }
}
console.log('\n');

/** Leg cost departing at an arbitrary clock time, interpolated between buckets. */
function leg(i, j, clock) {
  const h = ((clock % 1440) + 1440) % 1440 / (1440 / BUCKETS);
  const b0 = Math.floor(h) % BUCKETS, b1 = (b0 + 1) % BUCKETS, f = h - Math.floor(h);
  return matrix[i][j][b0] * (1 - f) + matrix[i][j][b1] * f;
}

function evaluate(order, departMinutes) {
  let clock = departMinutes, total = 0;
  for (let k = 1; k < order.length; k++) {
    const t = leg(order[k - 1], order[k], clock);
    if (!Number.isFinite(t)) return Infinity;
    total += t; clock += t;
  }
  return total;
}

const middle = [];
for (let i = 1; i < N - 1; i++) middle.push(i);
const orders = [];
(function permute(arr, k = 0) {
  if (k === arr.length) { orders.push([0, ...arr, N - 1]); return; }
  for (let i = k; i < arr.length; i++) {
    [arr[k], arr[i]] = [arr[i], arr[k]];
    permute(arr, k + 1);
    [arr[k], arr[i]] = [arr[i], arr[k]];
  }
}(middle));

console.log(`${orders.length} possible orders\n`);
console.log('   depart   best order                                    total    vs best-order-at-00:00');

const label = (o) => o.map((i) => stops[i].name).join(' -> ');
let baselineOrder = null;
const winners = new Set();

for (const hour of DEPARTURES) {
  const depart = hour * 60;
  let best = null, bestCost = Infinity;
  for (const o of orders) {
    const c = evaluate(o, depart);
    if (c < bestCost) { bestCost = c; best = o; }
  }
  if (!baselineOrder) baselineOrder = best;
  winners.add(label(best));
  const baselineCost = evaluate(baselineOrder, depart);
  const penalty = baselineCost / bestCost - 1;
  console.log(`   ${String(hour).padStart(2, '0')}:00    ${label(best).padEnd(44)} ${hm(bestCost).padStart(6)}`
    + `   ${penalty > 0.0005 ? `+${(100 * penalty).toFixed(1)}%  <-- DIFFERENT ORDER WINS` : 'same order'}`);
}

// How much is getting the order right worth at all?
const spreadAt = (hour) => {
  const costs = orders.map((o) => evaluate(o, hour * 60)).filter(Number.isFinite).sort((a, b) => a - b);
  return { best: costs[0], median: costs[Math.floor(costs.length / 2)], worst: costs[costs.length - 1] };
};
const s = spreadAt(6);
console.log(`\n   ordering is worth: median order costs +${(100 * (s.median / s.best - 1)).toFixed(1)}%, `
  + `worst +${(100 * (s.worst / s.best - 1)).toFixed(0)}%  (departing 06:00)`);

console.log(winners.size > 1
  ? `\n${winners.size} different orders win at different departure times.\n`
    + 'Order, departure and traffic are one joint decision — the first genuine\n'
    + 'reordering any system has produced.'
  : '\nThe same order wins at every departure time. Ordering matters, but it does\n'
    + 'not interact with departure time on this race.');
