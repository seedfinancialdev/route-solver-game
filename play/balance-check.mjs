#!/usr/bin/env node
// Is this still the game docs/SPEC.md describes?
//
//   npm run balance             the shipped set plus a bot sample — seconds
//   npm run balance -- --sweep  also the multiplier cliff — needs the cache
//
// The sweep reuses play/calibrate-hos.mjs's cache and never builds it: if the
// cache is absent it says so. That keeps this from silently costing 20 minutes.

import { readFileSync, existsSync } from 'node:fs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { roadReader } from './bots.mjs';
import { checkShippedSet, sweepRow, findCliff, formatSpecTable } from '../scripts/lib/balance.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

const SWEEP = process.argv.includes('--sweep');
const SAMPLE = 200;
const TRIALS = 6;
const CLIFF_MARGIN = 0.02; // docs/SPEC.md:221-224, "one road's worth of margin"
const MULTIPLIERS = [1.08, 1.09, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15];
const SPEC_WIN_RATE = 0.52; // docs/SPEC.md:217
// Must match play/calibrate-hos.mjs's own module-level constants of the same
// name — those are what the cache was validated against when it was written.
const CACHE_MIN_PENALTY = 1.12;
const CACHE_TRIALS = 6;

let pack, g;
try {
  pack = read('data/puzzles.json');
  g = buildGraph(read('data/graph.json'));
} catch (e) {
  console.error(`balance-check: cannot read data/puzzles.json or data/graph.json: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(pack?.puzzles) || !g?.cities) {
  console.error('balance-check: data/puzzles.json or data/graph.json is missing its expected shape');
  process.exit(2);
}

let failed = false;
const fail = (msg) => { failed = true; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const show = (list) => list.slice(0, 5).forEach((f) => console.log(`          #${f.index}: ${f.reason}`));

console.log(`\n=== shipped set: ${pack.puzzles.length} puzzles, `
  + `multiplier ${pack.budgetMultiplier}, ${g.n} cities ===`);

// checkShippedSet calls readCriteria internally, which throws if data/puzzles.json
// has no `criteria` block (see scripts/lib/balance.mjs) — that is "the tool cannot
// run its checks," not "a check failed," so it exits 2, not 1.
let r;
try {
  r = checkShippedSet(pack, g.n);
} catch (e) {
  console.error(`balance-check: ${e.message}`);
  process.exit(2);
}

if (r.badIndices.length) {
  fail(`${r.badIndices.length} city indices are not in the graph — reselect with npm run data:puzzles`);
} else ok('every puzzle references a city the graph has');

if (r.shortestRoadWins.length) {
  fail(`the shortest road wins outright on ${r.shortestRoadWins.length} puzzles `
    + `(${pct(r.shortestRoadWins.length / r.total)}) — these are not puzzles. `
    + 'Reselect; do not lower the multiplier.');
  show(r.shortestRoadWins);
} else ok('the shortest road wins nothing');

if (r.trapFailures.length) {
  fail(`${r.trapFailures.length} puzzles are below the trap ratio`);
  show(r.trapFailures);
} else ok(`every puzzle clears the ${pack.criteria.MIN_SHORTEST_PENALTY} trap ratio`);

if (r.boundsFailures.length) {
  fail(`${r.boundsFailures.length} puzzles are outside the hours/hops bounds`);
  show(r.boundsFailures);
} else ok('every puzzle is within the hours and hops bounds');

// --- the simulated player, on a deterministic sample --------------------------
console.log(`\n=== simulated player: ${SAMPLE} puzzles x ${TRIALS} runs ===`);
const step = Math.max(1, Math.floor(pack.puzzles.length / SAMPLE));
const sample = pack.puzzles.filter((_, i) => i % step === 0).slice(0, SAMPLE);

let wins = 0, finished = 0, stuck = 0, worstRatio = 0;
for (const p of sample) {
  for (let t = 0; t < TRIALS; t++) {
    const run = roadReader(g, p.a, p.b, { seed: p.a * 977 + p.b * 13 + t, hos: true });
    finished++;
    if (run.stuck) { stuck++; continue; }
    if (run.minutes <= p.budgetMin) wins++;
    worstRatio = Math.max(worstRatio, run.minutes / p.optimalMin);
  }
}

const total = sample.length * TRIALS;
const winRate = finished ? wins / finished : 0;
const stuckRate = total ? stuck / total : 0;
console.log(`  win rate ${pct(winRate)} of ${finished} finished runs`);
console.log(`  dead-end rate ${pct(stuckRate)} (selection cap ${pct(pack.criteria.MAX_STUCK_RATE)})`);
console.log(`  worst finishing ratio ${worstRatio.toFixed(2)}x (selection cap ${pack.criteria.MAX_WORST_RATIO}x)`);

if (stuckRate > pack.criteria.MAX_STUCK_RATE) {
  fail(`dead-end rate over the ${pct(pack.criteria.MAX_STUCK_RATE)} cap`);
}
if (winRate < 0.30) fail(`win rate ${pct(winRate)} — the game is unwinnable, not merely hard`);
if (winRate > 0.75) fail(`win rate ${pct(winRate)} — the budget is no longer binding`);
if (Math.abs(winRate - SPEC_WIN_RATE) > 0.03) {
  console.log(`  warn  win rate has moved more than 3 points from the ${pct(SPEC_WIN_RATE)} at docs/SPEC.md:217`);
}
if (worstRatio > pack.criteria.MAX_WORST_RATIO) {
  console.log(`  warn  worst finishing ratio exceeds the selection cap — expected on a `
    + 're-run with different seeds, but investigate if it is far over');
}

// --- the cliff, opt-in -------------------------------------------------------
if (SWEEP) {
  console.log('\n=== multiplier sweep ===');
  const CACHE = new URL('data/.calibrate-hos-cache.json', ROOT);
  if (!existsSync(CACHE)) {
    console.log('  no sweep cache — run `npm run calibrate:hos` first (~20 min)');
    process.exit(failed ? 1 : 0);
  }
  const cache = JSON.parse(readFileSync(CACHE, 'utf8'));
  const { runs } = cache;
  const maxIndex = runs.reduce((max, r) => Math.max(max, r.a, r.b), -1);
  const cacheValid = cache.minPenalty === CACHE_MIN_PENALTY && cache.trials === CACHE_TRIALS
    && maxIndex < g.n;
  if (!cacheValid) {
    console.log('  cache was built against a different roster or configuration — delete '
      + 'data/.calibrate-hos-cache.json and re-run npm run calibrate:hos');
    process.exit(failed ? 1 : 0);
  }
  console.log(formatSpecTable(MULTIPLIERS.map((m) => sweepRow(runs, m))));

  const cliff = findCliff(runs, MULTIPLIERS);
  if (cliff === null) {
    console.log(`\n  no cliff at or below ${MULTIPLIERS.at(-1)} — widen the swept range to find it`);
  } else {
    const margin = cliff - pack.budgetMultiplier;
    console.log(`\n  cliff at ${cliff.toFixed(2)}, shipped multiplier ${pack.budgetMultiplier}, `
      + `margin ${margin.toFixed(2)}`);
    if (margin < CLIFF_MARGIN) {
      fail(`margin ${margin.toFixed(2)} is under the ${CLIFF_MARGIN} minimum (docs/SPEC.md:221-224)`);
    } else ok(`margin clears the ${CLIFF_MARGIN} minimum`);
  }
  console.log('\n  paste the table at docs/SPEC.md:213 if these numbers have moved.');
}

process.exit(failed ? 1 : 0);
