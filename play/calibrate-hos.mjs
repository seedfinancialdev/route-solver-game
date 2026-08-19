// The budget-multiplier sweep, redone with the driving-hours rule (EC
// 561/2006, scripts/lib/graph.mjs hosDijkstra/hosCost) turned on.
//
// Mirrors calibrate.mjs's structure and criteria exactly — same bounds, same
// two players — with one change: "optimal" now means the fastest *legal*
// route (hosOptimal), not the fastest route ignoring mandatory breaks. This
// finds the multiplier that restores the same difficulty character (0%
// shortest-road-trap wins, ~50%+ informed-player wins) against that new,
// larger baseline. scripts/02-puzzles.mjs uses the result to select puzzles
// from scratch, not to patch old ones in place — the rule's overhead isn't
// uniform across pairs, so a puzzle set selected before it existed doesn't
// reliably stay valid once it's on (measured directly: patching the old
// selection's budgets in place, without reselecting, left 8.5% of it broken).
//
// The candidate pool is filtered on the same MIN_PENALTY (1.12) the original
// used, which means — same as the original — any multiplier below 1.12 is
// mathematically guaranteed 0% shortest-road wins, by construction of the
// pool itself. The multiplier range swept has to bracket that, not sit above
// it (a first pass here that only tried >= 1.16 found 67-100% shortest-road
// wins everywhere it looked, because it never tried a multiplier below the
// pool's own filter threshold).
//
// The pool + reader-run computation (the expensive ~20 minute part) is
// cached to disk, so re-sweeping a different multiplier range after reading
// the results doesn't require redoing it. Delete the cache file to force a
// fresh scan (e.g. after MIN_PENALTY or the bounds below change).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildGraph, dijkstra, pathFrom } from '../scripts/lib/graph.mjs';
import { shortestRouter, roadReader, hosOptimal } from './bots.mjs';

const CACHE_PATH = new URL('../data/.calibrate-hos-cache.json', import.meta.url);
const MIN_PENALTY = 1.12;
const TRIALS = 6;
const MULTIPLIERS = [1.08, 1.09, 1.10, 1.11, 1.12, 1.13, 1.14];

let runs;
if (existsSync(CACHE_PATH)) {
  const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  if (cache.minPenalty === MIN_PENALTY && cache.trials === TRIALS) {
    runs = cache.runs;
    console.log(`loaded ${runs.length} cached candidate pairs from ${CACHE_PATH.pathname}\n`);
  }
}

if (!runs) {
  const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));
  const byMin = Array.from({ length: g.n }, (_, i) => dijkstra(g, i, (e) => e.min));

  // HOS overhead only ever adds time (never subtracts), so the pre-filter
  // window on the plain (no-HOS) optimal is asymmetric: the low end needs
  // dividing by roughly the worst-case overhead seen (1.111-1.167 measured
  // across the shipped set), the high end only needs a small safety margin
  // below the best case, not the same wide margin mirrored on both sides.
  const LOW_MARGIN = 1.25;
  const HIGH_SAFETY = 1.05;

  // shortestRouter already applies the real HOS cost to its one fixed path
  // (a simple O(hops) walk, not a state-space search), so it's cheap and
  // exact — no separate "plain" version needed. What's expensive is
  // hosOptimal's search over (city, rest) states; PREFILTER_PENALTY, checked
  // against a rough estimate of the true optimum, decides whether that search
  // is worth paying for. Loosened well below the real 1.12 bar so nothing
  // genuine gets cut on the estimate alone.
  const PREFILTER_PENALTY = 1.05;
  const RATIO_ESTIMATE = 1.15; // median measured HOS/plain ratio across the shipped set (1.148)

  const pool = [];
  let preScanned = 0, total = 0;
  const t0 = Date.now();
  for (let a = 0; a < g.n; a++) {
    for (let b = a + 1; b < g.n; b++) {
      total++;
      const plainOpt = byMin[a].dist[b];
      // Cheap narrow net on the plain optimal, since byMin is already computed
      // for every source — avoids the O(hops) shortestRouter call, let alone
      // hosOptimal, for pairs that were never going to land in range anyway.
      if (plainOpt < (12 * 60) / LOW_MARGIN || plainOpt > (40 * 60) / HIGH_SAFETY) continue;
      const hops = pathFrom(byMin[a].prev, a, b).length - 1;
      if (hops < 7 || hops > 16) continue;
      const short = shortestRouter(g, a, b).minutes; // real HOS cost, cheap
      const estOpt = plainOpt * RATIO_ESTIMATE;
      if (short / estOpt < PREFILTER_PENALTY) continue;
      preScanned++;
      if (preScanned % 250 === 0) {
        console.log(`  ${preScanned} pre-filtered so far (${pool.length} qualifying), `
          + `${((Date.now() - t0) / 1000).toFixed(0)}s, ${(total / (g.n * (g.n - 1) / 2) * 100).toFixed(0)}% of all pairs scanned`);
      }
      const opt = hosOptimal(g, a, b);
      if (opt.stuck || opt.minutes < 12 * 60 || opt.minutes > 40 * 60) continue;
      if (short / opt.minutes < MIN_PENALTY) continue;
      pool.push({ a, b, optMin: opt.minutes, short });
    }
  }

  console.log(`pre-filtered to ${preScanned} pairs for the exact hosOptimal check, ${pool.length} qualify, `
    + `${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

  runs = pool.map((p) => ({
    ...p,
    reader: Array.from({ length: TRIALS }, (_, t) =>
      roadReader(g, p.a, p.b, { seed: p.a * 977 + p.b * 13 + t, hos: true }).minutes),
  }));

  writeFileSync(CACHE_PATH, JSON.stringify({ minPenalty: MIN_PENALTY, trials: TRIALS, runs }));
  console.log(`cached to ${CACHE_PATH.pathname}\n`);
}

const hrs = (m) => (m / 60).toFixed(1);
console.log(`sweep over ${runs.length} candidate pairs, ${TRIALS} runs each\n`);
console.log('mult   shortest-road wins   road-reader wins   median win margin   median bust');
for (const m of MULTIPLIERS) {
  let shortWins = 0, readerWins = 0, n = 0;
  const margins = [], busts = [];
  for (const r of runs) {
    const budget = r.optMin * m;
    if (r.short <= budget) shortWins++;
    for (const t of r.reader) {
      n++;
      if (!Number.isFinite(t)) continue;
      if (t <= budget) { readerWins++; margins.push(budget - t); } else busts.push(t - budget);
    }
  }
  const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
  console.log(
    `${m.toFixed(2)}   ${`${(shortWins / runs.length * 100).toFixed(0)}%`.padStart(17)}   `
    + `${`${(readerWins / n * 100).toFixed(0)}%`.padStart(16)}   `
    + `${`${hrs(med(margins))}h`.padStart(17)}   ${`${hrs(med(busts))}h`.padStart(11)}`,
  );
}
console.log('\nThe multiplier has to sit below the point where taking the shortest road');
console.log('starts getting away with it — past that the trap stops being a trap.');
