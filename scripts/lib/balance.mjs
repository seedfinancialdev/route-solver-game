// The spec's difficulty criteria, made executable. Pure — no I/O, no logging.
//
// Thresholds are never hardcoded: they come from the puzzle pack's own
// `criteria` block, which is what generated the set. That makes this check
// incapable of drifting from the data it checks. See docs/SPEC.md:157-194.

/** The criteria block, or an explicit failure. Never a silent default. */
export function readCriteria(pack) {
  if (!pack.criteria) {
    throw new Error(
      'data/puzzles.json has no `criteria` block — regenerate it with '
      + '`npm run data:puzzles`. Refusing to check against assumed thresholds.',
    );
  }
  return pack.criteria;
}

/**
 * Every check that is pure arithmetic over the shipped set. No bot runs, so
 * this stays in milliseconds even at 9,310 puzzles.
 */
export function checkShippedSet(pack, cityCount) {
  const c = readCriteria(pack);
  const shortestRoadWins = [];
  const trapFailures = [];
  const boundsFailures = [];
  const bad = new Set();

  pack.puzzles.forEach((p, index) => {
    // Criterion 1, the load-bearing one: the shortest road is a free,
    // deterministic strategy. If it comes in under budget, the puzzle is not a
    // puzzle. docs/SPEC.md:161-173.
    if (p.shortestMin <= p.budgetMin) {
      shortestRoadWins.push({ index, reason: `shortest ${p.shortestMin} <= budget ${p.budgetMin}` });
    }
    const ratio = p.shortestMin / p.optimalMin;
    if (ratio < c.MIN_SHORTEST_PENALTY) {
      trapFailures.push({ index, reason: `trap ratio ${ratio.toFixed(3)} < ${c.MIN_SHORTEST_PENALTY}` });
    }
    const hours = p.optimalMin / 60;
    if (hours < c.MIN_HOURS || hours > c.MAX_HOURS) {
      boundsFailures.push({ index, reason: `${hours.toFixed(1)} hours outside ${c.MIN_HOURS}-${c.MAX_HOURS}` });
    } else if (p.hops < c.MIN_HOPS || p.hops > c.MAX_HOPS) {
      boundsFailures.push({ index, reason: `${p.hops} hops outside ${c.MIN_HOPS}-${c.MAX_HOPS}` });
    }
    for (const i of [p.a, p.b]) if (!(i >= 0 && i < cityCount)) bad.add(i);
  });

  return {
    total: pack.puzzles.length,
    shortestRoadWins,
    trapFailures,
    boundsFailures,
    badIndices: [...bad].sort((x, y) => x - y),
  };
}

const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);

/**
 * One row of the multiplier sweep. `runs` is the cached shape produced by
 * play/calibrate-hos.mjs:99-103 — { a, b, optMin, short, reader: number[] }.
 */
export function sweepRow(runs, multiplier) {
  let shortWins = 0, readerWins = 0, finished = 0;
  const margins = [], busts = [];
  for (const r of runs) {
    const budget = r.optMin * multiplier;
    if (r.short <= budget) shortWins++;
    for (const t of r.reader) {
      if (!Number.isFinite(t)) continue;
      finished++;
      if (t <= budget) { readerWins++; margins.push(budget - t); } else busts.push(t - budget);
    }
  }
  return {
    multiplier,
    shortWins,
    shortWinRate: runs.length ? shortWins / runs.length : 0,
    readerWins,
    readerWinRate: finished ? readerWins / finished : 0,
    medMarginMin: median(margins),
    medBustMin: median(busts),
  };
}

/**
 * The lowest swept multiplier at which the shortest road starts getting away
 * with it. docs/SPEC.md:221-224 requires the shipped multiplier to sit below
 * this by "one road's worth of margin", made numeric by the caller.
 */
export function findCliff(runs, multipliers) {
  for (const m of [...multipliers].sort((x, y) => x - y)) {
    if (sweepRow(runs, m).shortWins > 0) return m;
  }
  return null;
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const hrs = (m) => `${(m / 60).toFixed(1)}h`;

/** The markdown table for pasting into docs/SPEC.md at line 213. */
export function formatSpecTable(rows) {
  const head = '| multiplier | shortest-road player wins | road-reader wins | median win margin | median bust |\n'
    + '| --- | --- | --- | --- | --- |';
  const body = rows.map((r) => `| ${r.multiplier.toFixed(2)} | ${pct(r.shortWinRate)} `
    + `| ${pct(r.readerWinRate)} | ${hrs(r.medMarginMin)} | ${hrs(r.medBustMin)} |`);
  return [head, ...body].join('\n');
}
