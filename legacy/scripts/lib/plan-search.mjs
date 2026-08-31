// Every way to pick and order checkpoints, priced from a cached time matrix.
//
// This logic was duplicated inline in two measurement gates (scripts/26,
// scripts/27) before either had a name for it. Pulled out here so the gates,
// the medal/record calculation, and the planner UI all call the same code —
// the rule this whole project runs on: derived numbers live in one place.
//
// A "matrix" is the shape scripts/26 caches to data/checkpoint-matrix.json:
// { buckets, N, timed } where timed[i][j][b] is the traffic-timed minutes
// from stop i to stop j departing in time bucket b, or null/Infinity if that
// leg is unreachable.

export function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const p of permutations(rest)) out.push([items[i], ...p]);
  }
  return out;
}

export function subsetsOfSize(items, k) {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...tail] = items;
  return [...subsetsOfSize(tail, k - 1).map((s) => [head, ...s]), ...subsetsOfSize(tail, k)];
}

/** A matrix's leg cost at an arbitrary clock time, interpolated between buckets. */
export function matrixLeg(matrix, i, j, clockMinutes) {
  const cell = matrix.timed[i][j];
  const h = ((clockMinutes % 1440) + 1440) % 1440 / (1440 / matrix.buckets);
  const b0 = Math.floor(h) % matrix.buckets, b1 = (b0 + 1) % matrix.buckets, f = h - Math.floor(h);
  const v0 = cell[b0] ?? Infinity, v1 = cell[b1] ?? Infinity;
  return v0 * (1 - f) + v1 * f;
}

/** Total minutes for a stop order, with the clock advancing leg by leg. */
export function evaluateOrder(matrix, order, departMinutes) {
  let clock = departMinutes, total = 0;
  for (let k = 1; k < order.length; k++) {
    const t = matrixLeg(matrix, order[k - 1], order[k], clock);
    if (!Number.isFinite(t)) return Infinity;
    total += t; clock += t;
  }
  return total;
}

/**
 * Every (set, order) plan for picking `pick` of `candidateIds`, fixed start
 * and finish. Each plan's `order` is the full stop-index sequence, start and
 * finish included, ready to hand to evaluateOrder.
 */
export function allPlans({ candidateIds, pick, start, finish }) {
  const plans = [];
  for (const set of subsetsOfSize(candidateIds, pick)) {
    for (const p of permutations(set)) plans.push({ order: [start, ...p, finish] });
  }
  return plans;
}

/** The cheapest plan, or null if nothing reaches the finish. */
export function bestPlan(matrix, pickSpec, departMinutes) {
  let best = null, bestMinutes = Infinity;
  for (const plan of allPlans(pickSpec)) {
    const minutes = evaluateOrder(matrix, plan.order, departMinutes);
    if (minutes < bestMinutes) { bestMinutes = minutes; best = { ...plan, minutes }; }
  }
  return best;
}

/**
 * The cheapest plan over a set of candidate departure times.
 *
 * This is what a medal target should search — not just the best order at a
 * fixed hour, but the best (order, departure) pair together, since departure
 * is a real decision in its own right (measured worth ~1h30 absolute on the
 * reference race) and a record time is entitled to the best of both.
 */
export function bestPlanAcrossDepartures(matrix, pickSpec, departureCandidates) {
  let best = null;
  for (const departMinutes of departureCandidates) {
    const plan = bestPlan(matrix, pickSpec, departMinutes);
    if (plan && (!best || plan.minutes < best.minutes)) best = { ...plan, departMinutes };
  }
  return best;
}
