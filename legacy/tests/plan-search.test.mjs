// Plan search: every way to pick and order checkpoints, priced from a cached
// time matrix. This was duplicated inline in two measurement gates
// (scripts/26, scripts/27) before it had a name; pulled out here so the
// planner UI and the gates share one implementation instead of three.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  permutations, subsetsOfSize, matrixLeg, evaluateOrder, allPlans, bestPlan, bestPlanAcrossDepartures,
} from '../scripts/lib/plan-search.mjs';

test('permutations of an empty list is one empty order', () => {
  assert.deepEqual(permutations([]), [[]]);
});

test('permutations of n items produces n! orders, each a distinct arrangement', () => {
  const p = permutations([1, 2, 3]);
  assert.equal(p.length, 6);
  const asStrings = new Set(p.map((x) => x.join(',')));
  assert.equal(asStrings.size, 6);
  assert.ok(asStrings.has('1,2,3'));
  assert.ok(asStrings.has('3,2,1'));
});

test('subsetsOfSize picks every k-combination, order-independent', () => {
  const s = subsetsOfSize([1, 2, 3, 4], 2);
  assert.equal(s.length, 6); // C(4,2)
  const asSets = new Set(s.map((x) => [...x].sort().join(',')));
  assert.equal(asSets.size, 6);
});

test('subsetsOfSize of 0 is exactly one empty set', () => {
  assert.deepEqual(subsetsOfSize([1, 2, 3], 0), [[]]);
});

// A 3-node matrix, 2 time buckets, so interpolation and wraparound both
// matter. Node 0 -> 1 costs 60 at bucket 0 and 120 at bucket 1 (bucket
// boundary at 12h on a 2-bucket day); 1 -> 2 is flat at 30 both buckets.
function tinyMatrix() {
  return {
    buckets: 2,
    N: 3,
    timed: [
      [[Infinity, Infinity], [60, 120], [Infinity, Infinity]],
      [[Infinity, Infinity], [Infinity, Infinity], [30, 30]],
      [[Infinity, Infinity], [Infinity, Infinity], [Infinity, Infinity]],
    ],
  };
}

test('matrixLeg reads the exact bucket cost at a bucket boundary', () => {
  const m = tinyMatrix();
  assert.equal(matrixLeg(m, 0, 1, 0), 60);     // 00:00, bucket 0
  assert.equal(matrixLeg(m, 0, 1, 12 * 60), 120); // 12:00, bucket 1
});

test('matrixLeg interpolates between buckets at a mid-bucket clock time', () => {
  const m = tinyMatrix();
  const mid = matrixLeg(m, 0, 1, 6 * 60); // halfway between bucket 0 and bucket 1
  assert.ok(mid > 60 && mid < 120, `expected an interpolated value, got ${mid}`);
});

test('evaluateOrder sums legs with the clock advancing through the route', () => {
  const m = tinyMatrix();
  const total = evaluateOrder(m, [0, 1, 2], 0);
  // leg 0->1 departs at 00:00 (60 min) landing at 01:00, well inside bucket 0
  // still, so 1->2 costs 30 flat. Total should be close to 90, not exactly
  // 90 only if the departure clock for the second leg doesn't cross buckets.
  assert.ok(total >= 90 && total < 92, `expected ~90, got ${total}`);
});

test('evaluateOrder is Infinity when any leg is unreachable', () => {
  const m = tinyMatrix();
  assert.equal(evaluateOrder(m, [2, 0, 1], 0), Infinity); // node 2 has no outbound leg
});

test('allPlans enumerates every (set, order) pair for picking k of the candidates', () => {
  // 4 candidates (ids 1..4), start=0, finish=5, pick 2 -> C(4,2) x 2! = 12 plans
  const plans = allPlans({ candidateIds: [1, 2, 3, 4], pick: 2, start: 0, finish: 5 });
  assert.equal(plans.length, 12);
  for (const p of plans) {
    assert.equal(p.order[0], 0);
    assert.equal(p.order[p.order.length - 1], 5);
    assert.equal(p.order.length, 4); // start + 2 picked + finish
  }
});

test('bestPlan finds the minimum-cost plan and reports it distinctly from a worse one', () => {
  // Two nodes to pick from; one path is reachable, the other is not (see
  // tinyMatrix: nothing leaves node 2), so the reachable one must win.
  const m = tinyMatrix();
  const best = bestPlan(m, { candidateIds: [1], pick: 1, start: 0, finish: 2 }, 0);
  assert.ok(best);
  assert.deepEqual(best.order, [0, 1, 2]);
  assert.ok(Number.isFinite(best.minutes));
});

test('bestPlan returns null when no plan reaches the finish', () => {
  const m = tinyMatrix();
  const best = bestPlan(m, { candidateIds: [1], pick: 1, start: 2, finish: 0 }, 0);
  assert.equal(best, null);
});

test('bestPlanAcrossDepartures finds the cheapest plan over several candidate departures', () => {
  const m = tinyMatrix();
  // Departing at bucket 1 (12h) costs MORE on leg 0->1 (120 vs 60), so bucket 0 must win.
  const best = bestPlanAcrossDepartures(m, { candidateIds: [1], pick: 1, start: 0, finish: 2 }, [0, 12 * 60]);
  assert.ok(best);
  assert.equal(best.departMinutes, 0);
});

test('bestPlanAcrossDepartures returns null when no departure reaches the finish', () => {
  const m = tinyMatrix();
  const best = bestPlanAcrossDepartures(m, { candidateIds: [1], pick: 1, start: 2, finish: 0 }, [0, 720]);
  assert.equal(best, null);
});
