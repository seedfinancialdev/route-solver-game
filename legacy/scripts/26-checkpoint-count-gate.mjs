// How many checkpoints does a race need before the ordering is actually hard?
//
// Checkpoint ordering is the only system that has changed the answer. Four
// intermediates on the Grand Tour cost +17.3% for a median ordering and +32%
// for the worst. Everything else measured — driving hours, fuel, enforcement
// exposure, departure time — left the winning route untouched.
//
// So the follow-up question is a design parameter: how many checkpoints?
//
// Factorial count is the obvious answer and it is the wrong one. Four is 24
// orderings, six is 720, eight is 40,320 — but a player does not enumerate,
// they look at a map and go round in a sensible loop. What makes ordering hard
// is not how many orders exist, it is whether the obvious one is wrong.
//
// Four things get measured at each checkpoint count:
//
//   median penalty     what an uninformed ordering costs — the size of the decision
//   greedy penalty     what "always drive to the nearest unvisited city" costs.
//                      This is the real difficulty number: if the obvious
//                      heuristic lands on the optimum, the puzzle is a
//                      formality however many permutations exist.
//   traffic-blind      what planning the order on a free-flow map costs. If it
//                      is zero, ordering is pure geometry and knowing about
//                      traffic buys the player nothing.
//   near-ties          orders within 1% of best. A broad plateau means there is
//                      no single right answer to find.
//
// Every subset of the candidate cities is measured at every size, so the answer
// is a curve rather than one race's quirk.
//
// Usage: npm run order:count
//        npm run order:count -- 21    (departure hour, default 6)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadGraph, junctionNode, timesFrom, timesFromTimed, travelMinutes } from '../../scripts/lib/road-graph.mjs';
import { loadRace } from './lib/race.mjs';
import { buildUrbanField, throughClasses, congestion } from './lib/traffic.mjs';

const BUCKETS = 8;                     // 3-hour resolution on the cost matrix
const DEPART_HOUR = Number(process.argv[2] ?? 6);
const NEAR_TIE = 0.01;                 // within 1% of best counts as "no decision"

const CACHE = 'data/checkpoint-matrix.json';

const { race, stops, candidates: CANDIDATES, signature } = loadRace(process.env.RACE || 'grand-tour-menu');
const N = stops.length;

console.log(`${race.name}: ${stops[0].name} -> ${stops[N - 1].name}, `
  + `departing ${String(DEPART_HOUR).padStart(2, '0')}:00`);
console.log(`candidates: ${CANDIDATES.map((c) => c.name).join(', ')}\n`);

// ---- cost matrices --------------------------------------------------------
// The matrix is the whole cost of this measurement — 81 continental sweeps,
// about eleven minutes — and it does not depend on departure hour or on which
// subsets get measured. Cached so that re-reading the same world is instant.
let timed, free;
const cached = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : null;
if (cached && cached.signature === signature && cached.buckets === BUCKETS) {
  ({ timed, free } = cached);
  timed = timed.map((r) => r.map((c) => c.map((v) => (v === null ? Infinity : v))));
  free = free.map((r) => r.map((v) => (v === null ? Infinity : v)));
  console.log(`  matrix from cache (${CACHE}, built ${cached.built})\n`);
} else {
  const g = loadGraph('data/road-graph');
  const urban = buildUrbanField(g);
  const through = throughClasses(g);
  const cost = (e, clock) => travelMinutes(g, e) * congestion(g, urban, through, e, clock);
  const nodes = stops.map((s) => junctionNode(g, s.lon, s.lat));

  // One sweep answers every destination at once, so the matrix is 9 sources x
  // 9 sweeps rather than 72 ordered pairs x 8 buckets.
  timed = Array.from({ length: N }, () => Array.from({ length: N }, () => new Array(BUCKETS).fill(Infinity)));
  free = Array.from({ length: N }, () => new Array(N).fill(Infinity));
  const t0 = Date.now();
  let sweep = 0;
  const total = (N - 1) * (BUCKETS + 1);
  for (let i = 0; i < N - 1; i++) {                  // nothing ever leaves the finish
    const flat = timesFrom(g, nodes[i]);
    for (let j = 0; j < N; j++) free[i][j] = flat[nodes[j]];
    process.stdout.write(`\r  matrix ${++sweep}/${total} sweeps`);
    for (let b = 0; b < BUCKETS; b++) {
      const d = timesFromTimed(g, nodes[i], (b * 24 / BUCKETS) * 60, cost);
      for (let j = 0; j < N; j++) timed[i][j][b] = d[nodes[j]];
      process.stdout.write(`\r  matrix ${++sweep}/${total} sweeps`);
    }
  }
  console.log(`  (${((Date.now() - t0) / 1000 / 60).toFixed(1)} min)\n`);
  const finite = (v) => (Number.isFinite(v) ? v : null);   // JSON has no Infinity
  writeFileSync(CACHE, JSON.stringify({
    built: new Date().toISOString().slice(0, 10),
    world: JSON.parse(readFileSync('data/road-graph/graph.meta.json', 'utf8')).built,
    signature, buckets: BUCKETS,
    stops: stops.map((s) => s.name),
    free: free.map((r) => r.map(finite)),
    timed: timed.map((r) => r.map((c) => c.map(finite))),
  }));
}

const pct = (x) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}%`;

/** Leg cost departing at an arbitrary clock time, interpolated between buckets. */
function leg(i, j, clock) {
  const h = ((clock % 1440) + 1440) % 1440 / (1440 / BUCKETS);
  const b0 = Math.floor(h) % BUCKETS, b1 = (b0 + 1) % BUCKETS, f = h - Math.floor(h);
  return timed[i][j][b0] * (1 - f) + timed[i][j][b1] * f;
}

/** Total minutes for an ordering, with the clock running through it. */
function evaluate(order, departMinutes) {
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

/** What a player who never looks past the next city does. */
function greedyOrder(ids, matrix) {
  const left = new Set(ids);
  const order = [0];
  let at = 0;
  while (left.size) {
    let next = -1, bestLeg = Infinity;
    for (const i of left) if (matrix[at][i] < bestLeg) { bestLeg = matrix[at][i]; next = i; }
    order.push(next); left.delete(next); at = next;
  }
  order.push(N - 1);
  return order;
}

/** Cheapest ordering under a static matrix — planning on a free-flow map. */
function staticBest(ids) {
  let best = null, bestCost = Infinity;
  for (const p of permutations(ids)) {
    const order = [0, ...p, N - 1];
    let c = 0;
    for (let k = 1; k < order.length; k++) c += free[order[k - 1]][order[k]];
    if (c < bestCost) { bestCost = c; best = order; }
  }
  return best;
}

// ---- reachability -------------------------------------------------------
// A candidate that cannot be driven out of would silently remove every subset
// containing it, and the count column would quietly shrink. Report it instead.
const usable = [];
for (let i = 1; i < N - 1; i++) {
  const inbound = Number.isFinite(free[0][i]);
  const outbound = Number.isFinite(free[i][N - 1]);
  if (inbound && outbound) usable.push(i);
  else console.log(`  DROPPED ${stops[i].name}: ${inbound ? 'cannot leave it' : 'cannot reach it'}`);
}
if (usable.length < CANDIDATES.length) console.log();

// ---- the measurement ------------------------------------------------------
const depart = DEPART_HOUR * 60;
console.log('  checkpoints  races  orders  median order  per checkpoint  worst order  greedy plan  traffic-blind  within 1%');

const rows = [];
for (let k = 2; k <= usable.length; k++) {
  const subsets = subsetsOfSize(usable, k);
  const agg = { median: [], worst: [], greedy: [], blind: [], ties: [], best: [] };
  let blindDiffers = 0;

  for (const ids of subsets) {
    const orders = permutations(ids).map((p) => [0, ...p, N - 1]);
    const costs = orders.map((o) => evaluate(o, depart));
    if (!costs.every(Number.isFinite)) throw new Error(`unroutable ordering among ${ids.map((i) => stops[i].name)}`);
    const bestAt = costs.indexOf(Math.min(...costs));
    const best = costs[bestAt];
    const sorted = [...costs].sort((a, b) => a - b);

    const blindOrder = staticBest(ids);
    if (blindOrder.join() !== orders[bestAt].join()) blindDiffers++;

    agg.best.push(best);
    agg.median.push(sorted[Math.floor(sorted.length / 2)] / best - 1);
    agg.worst.push(sorted[sorted.length - 1] / best - 1);
    agg.greedy.push(evaluate(greedyOrder(ids, free), depart) / best - 1);
    agg.blind.push(evaluate(blindOrder, depart) / best - 1);
    agg.ties.push(sorted.filter((c) => c <= best * (1 + NEAR_TIE)).length / sorted.length);
  }

  const mean = (a) => a.reduce((sum, x) => sum + x, 0) / a.length;
  const row = {
    k,
    races: subsets.length,
    orders: permutations(new Array(k).fill(0).map((_, i) => i)).length,
    hours: mean(agg.best) / 60,
    median: mean(agg.median),
    worst: mean(agg.worst),
    greedy: mean(agg.greedy),
    blind: mean(agg.blind),
    ties: mean(agg.ties),
    greedyOptimal: agg.greedy.filter((x) => x <= NEAR_TIE).length,
    blindDiffers,
  };
  rows.push(row);
  console.log(`  ${String(k).padStart(11)}  ${String(row.races).padStart(5)}  ${String(row.orders).padStart(6)}  `
    + `${pct(row.median).padStart(12)}  ${pct(row.median / k).padStart(14)}  ${pct(row.worst).padStart(11)}  ${pct(row.greedy).padStart(11)}  `
    + `${pct(row.blind).padStart(13)}  ${(100 * row.ties).toFixed(1).padStart(8)}%`);
}

console.log('\n  Averaged over every subset of that size. "greedy plan" is nearest-unvisited-city,');
console.log('  "traffic-blind" is the best order on a free-flow map, both priced under traffic.\n');

for (const r of rows) {
  console.log(`  ${r.k} checkpoints: ${r.hours.toFixed(1)}h optimal, `
    + `greedy already optimal on ${r.greedyOptimal}/${r.races} races, `
    + `free-flow plan picks a different order on ${r.blindDiffers}/${r.races}`);
}

// ---- selection, as opposed to ordering ------------------------------------
// A different race format: "pass through any k of these cities, your choice".
// Ordering is a travelling-salesman problem and Google Maps will solve one
// (its waypoint optimiser handles up to ten stops). Choosing WHICH stops is
// not a problem it offers to solve, so if selection carries a real penalty it
// is a decision that survives a second browser tab.
console.log('\n  Same pool, but the player picks which k to visit:');
console.log('    k   choices  wrong pick (median)  wrong pick (worst)  best set');
for (let k = 2; k <= usable.length - 1; k++) {
  const subsets = subsetsOfSize(usable, k);
  const optima = subsets.map((ids) => {
    const costs = permutations(ids).map((p) => evaluate([0, ...p, N - 1], depart));
    return { ids, cost: Math.min(...costs) };
  }).sort((a, b) => a.cost - b.cost);
  const best = optima[0];
  const median = optima[Math.floor(optima.length / 2)];
  const worst = optima[optima.length - 1];
  console.log(`  ${String(k).padStart(3)}  ${String(subsets.length).padStart(7)}  `
    + `${pct(median.cost / best.cost - 1).padStart(19)}  ${pct(worst.cost / best.cost - 1).padStart(18)}  `
    + `${best.ids.map((i) => stops[i].name).join(', ')}`);
}

// ---- what the curve says --------------------------------------------------
const first = rows[0], last = rows[rows.length - 1];
console.log();
console.log(last.median > first.median * 1.3
  ? `Ordering gets harder with more checkpoints: a median ordering costs ${pct(first.median)} at ${first.k}`
    + ` and ${pct(last.median)} at ${last.k}.`
  : `More checkpoints do NOT widen the ordering decision: ${pct(first.median)} at ${first.k}`
    + ` against ${pct(last.median)} at ${last.k}.`);

const hardest = rows.reduce((a, b) => (b.greedy > a.greedy ? b : a));
console.log(hardest.greedy > 0.05
  ? `The obvious plan fails hardest at ${hardest.k} checkpoints, costing ${pct(hardest.greedy)} —`
    + ` that is where a player has to actually think rather than go round in a loop.`
  : `Nearest-unvisited-city stays within ${pct(hardest.greedy)} of optimal at every count.`
    + ` The permutation counts are large but the puzzle is not.`);

const blindMax = rows.reduce((a, b) => (b.blind > a.blind ? b : a));
const blindDiffs = rows.reduce((sum, r) => sum + r.blindDiffers, 0);
const raceCount = rows.reduce((sum, r) => sum + r.races, 0);
console.log(blindMax.blind > 0.02
  ? `Traffic knowledge changes the chosen order and is worth up to ${pct(blindMax.blind)}.`
  : `Planning the order on a free-flow map picks a different order on only ${blindDiffs}/${raceCount} races,`
    + ` and costs ${pct(blindMax.blind)} at worst. Ordering is geometry; traffic is priced into the clock,`
    + ` not into the order.`);
