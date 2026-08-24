// The router's time-dependent sweep.
//
// A checkpoint run needs the cost of every leg between every pair of stops at
// every departure hour. Doing that pairwise is one full search per pair; a
// one-to-all sweep answers every destination at once, which is the difference
// between 344 searches and 64 on an eight-stop run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { junctionNode, nearestNode, timesFrom, timesFromTimed, travelMinutes } from '../scripts/lib/road-graph.mjs';

/** Four nodes in a line, every edge 1 km at 60 km/h, so every hop is 1 minute. */
function lineGraph() {
  const g = {
    meta: { flags: { oneway: 1 } },
    n: 4,
    e: 3,
    a: Int32Array.from([0, 1, 2]),
    b: Int32Array.from([1, 2, 3]),
    m: Uint32Array.from([1000, 1000, 1000]),
    kmh: Uint8Array.from([60, 60, 60]),
    cls: Uint8Array.from([0, 0, 0]),
    flags: Uint8Array.from([0, 0, 0]),
    off: Uint32Array.from([0, 1, 3, 5, 6]),
    to: Int32Array.from([1, 0, 2, 1, 3, 2]),
    via: Uint32Array.from([0, 0, 1, 1, 2, 2]),
  };
  return g;
}

test('free-flow costs make the timed sweep agree with the untimed one', () => {
  const g = lineGraph();
  const flat = (edge) => travelMinutes(g, edge);
  const timed = timesFromTimed(g, 0, 0, flat);
  const plain = timesFrom(g, 0);
  assert.deepEqual(Array.from(timed), Array.from(plain));
  assert.deepEqual(Array.from(timed), [0, 1, 2, 3]);
});

test('an edge reached later costs what it costs later', () => {
  const g = lineGraph();
  // Everything doubles from 01:30 onwards, so only the third hop pays.
  const rush = (edge, clock) => travelMinutes(g, edge) * (clock >= 1.5 ? 2 : 1);
  assert.deepEqual(Array.from(timesFromTimed(g, 0, 0, rush)), [0, 1, 2, 4]);
});

test('departure time shifts which hops land in the peak', () => {
  const g = lineGraph();
  const rush = (edge, clock) => travelMinutes(g, edge) * (clock >= 1.5 ? 2 : 1);
  // Leaving at 01:00, the first hop still starts before the threshold and only
  // the last two pay. Leaving half an hour later, all three do.
  assert.deepEqual(Array.from(timesFromTimed(g, 0, 1, rush)), [0, 1, 3, 5]);
  assert.deepEqual(Array.from(timesFromTimed(g, 0, 1.5, rush)), [0, 2, 4, 6]);
});

test('unreachable nodes stay at infinity', () => {
  const g = lineGraph();
  g.n = 5;
  g.off = Uint32Array.from([0, 1, 3, 5, 6, 6]);
  const flat = (edge) => travelMinutes(g, edge);
  assert.equal(timesFromTimed(g, 0, 0, flat)[4], Infinity);
});

// ---- snapping a landmark to a usable junction ------------------------------
//
// nearestNode() snaps to whatever node is closest, and in a city centre that is
// frequently a one-way sink: reachable, but with no way out. Vienna did exactly
// this — the nearest node to the city centre had out-degree 0, so every
// checkpoint ordering that put Vienna in the middle was unroutable and the
// measurement silently dropped it.

/**
 * Two nodes near the same point: a dead-end sink at the target, and a real
 * junction 0.01 degrees away.
 */
function sinkAndJunction() {
  //  3 --\        node 0 = the sink (one-way in, nothing out)
  //  4 -- 1 -- 2   node 1 = a proper junction
  //  0 <--/
  const g = {
    meta: { flags: { oneway: 1 } },
    n: 5,
    xy: Float32Array.from([10.00, 50.00,  10.01, 50.00,  10.02, 50.00,  10.01, 50.01,  10.01, 49.99]),
    m: Uint32Array.from([1000, 1000, 1000, 1000]),
    kmh: Uint8Array.from([60, 60, 60, 60]),
    // out-edges: node 0 has none; node 1 reaches 0, 2, 3, 4
    off: Uint32Array.from([0, 0, 4, 5, 6, 7]),
    to: Int32Array.from([0, 2, 3, 4,  1,  1,  1]),
    via: Uint32Array.from([0, 1, 2, 3,  1,  2,  3]),
    cell: 0.05,
    grid: new Map([['200:1000', [0, 1, 2, 3, 4]]]),
  };
  return g;
}

test('nearestNode still returns the closest node, sink or not', () => {
  const g = sinkAndJunction();
  assert.equal(nearestNode(g, 10.0, 50.0), 0);
  assert.equal(g.off[1] - g.off[0], 0, 'node 0 is a sink with no way out');
});

test('junctionNode skips a node you cannot drive out of', () => {
  const g = sinkAndJunction();
  assert.equal(junctionNode(g, 10.0, 50.0), 1);
});

test('junctionNode prefers the nearest qualifying junction', () => {
  const g = sinkAndJunction();
  // Node 2 also has a way out, but only one — node 1 is the real junction.
  assert.equal(junctionNode(g, 10.02, 50.0), 1);
});

test('junctionNode falls back to the nearest node when nothing qualifies', () => {
  const g = sinkAndJunction();
  assert.equal(junctionNode(g, 10.0, 50.0, { minDegree: 99 }), 0);
});
