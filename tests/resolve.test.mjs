// Resolving one plan: a player's chosen order, car and departure time, priced
// on the real graph with real traffic, today's incidents added on top.
//
// Unlike the measurement gates, this runs ONE plan, not thousands — so it
// calls routeTimed() live per leg rather than reading a cached matrix. A
// player submits a plan once per attempt; a few live searches is the right
// cost for that, and it means the result can never be stale against the
// world the gates measure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carMinutes, resolveRun } from '../scripts/lib/resolve.mjs';

/** Same shape as road-graph.test.mjs's fixtures: a straight line, one hop per
 * segment, but with a mix of capped and derestricted edges so car cruise
 * speed actually matters. */
function lineGraph() {
  return {
    meta: { flags: { oneway: 1, maxspeedReal: 4 }, classes: ['motorway'] },
    n: 4,
    e: 3,
    a: Int32Array.from([0, 1, 2]),
    b: Int32Array.from([1, 2, 3]),
    m: Uint32Array.from([100000, 100000, 100000]),   // 100 km each
    kmh: Uint8Array.from([130, 150, 100]),            // capped, DERESTRICTED, capped
    cls: Uint8Array.from([0, 0, 0]),
    flags: Uint8Array.from([4, 4, 4]),                // all real readings
    off: Uint32Array.from([0, 1, 3, 5, 6]),
    to: Int32Array.from([1, 0, 2, 1, 3, 2]),
    via: Uint32Array.from([0, 0, 1, 1, 2, 2]),
  };
}

const noTraffic = { urban: { field: new Map(), peak: 1 }, through: new Set() }; // congestion() = 1 always

test('carMinutes uses the car\'s own cruise speed on a derestricted edge', () => {
  const g = lineGraph();
  const slow = { topKmh: 176 }, fast = { topKmh: 340 }; // cruiseKmh: 150, 240 (capped)
  assert.ok(carMinutes(g, 1, fast) < carMinutes(g, 1, slow), 'a faster car should be quicker on the open stretch');
});

test('carMinutes caps at the posted limit on a normal edge, regardless of car speed', () => {
  const g = lineGraph();
  const slow = { topKmh: 176 }, fast = { topKmh: 340 };
  assert.equal(carMinutes(g, 0, slow), carMinutes(g, 0, fast), 'both are limited to 130 km/h on edge 0');
});

test('resolveRun sums real leg times for a chosen order and car', () => {
  const g = lineGraph();
  const car = { topKmh: 250 };
  const stops = [{ name: 'A', node: 0 }, { name: 'B', node: 2 }, { name: 'C', node: 3 }];
  const result = resolveRun({ g, ...noTraffic }, stops, [0, 1, 2], car, 6 * 60, []);
  assert.equal(result.legs.length, 2);
  assert.equal(result.legs[0].from, 'A');
  assert.equal(result.legs[0].to, 'B');
  assert.ok(result.totalMinutes > 0 && Number.isFinite(result.totalMinutes));
  const summed = result.legs.reduce((s, l) => s + l.minutes, 0);
  assert.ok(Math.abs(summed - result.totalMinutes) < 1e-6);
});

test('resolveRun applies a matching incident to the right leg, and only that leg', () => {
  const g = lineGraph();
  const car = { topKmh: 250 };
  const stops = [{ name: 'A', node: 0 }, { name: 'B', node: 2 }, { name: 'C', node: 3 }];
  const bare = resolveRun({ g, ...noTraffic }, stops, [0, 1, 2], car, 6 * 60, []);
  const withIncident = resolveRun({ g, ...noTraffic }, stops, [0, 1, 2], car, 6 * 60,
    [{ from: 'A', to: 'B', delayMinutes: 40, note: 'test closure' }]);

  assert.equal(withIncident.legs[0].minutes, bare.legs[0].minutes + 40);
  assert.equal(withIncident.legs[1].minutes, bare.legs[1].minutes, 'the other leg is untouched');
  assert.equal(withIncident.legs[0].incidentNote, 'test closure');
  assert.equal(withIncident.totalMinutes, bare.totalMinutes + 40);
});

test('resolveRun matches an incident regardless of stop direction', () => {
  const g = lineGraph();
  const car = { topKmh: 250 };
  const stops = [{ name: 'A', node: 0 }, { name: 'B', node: 2 }];
  const forward = resolveRun({ g, ...noTraffic }, stops, [0, 1], car, 6 * 60,
    [{ from: 'B', to: 'A', delayMinutes: 15, note: 'reverse-listed' }]);
  assert.equal(forward.legs[0].incidentNote, 'reverse-listed');
});

test('resolveRun returns null when a leg is unreachable rather than NaN', () => {
  const g = lineGraph();
  g.off = Uint32Array.from([0, 1, 3, 5, 5]); // node 3 now has no outgoing edges, irrelevant here
  const car = { topKmh: 250 };
  const stops = [{ name: 'A', node: 3 }, { name: 'B', node: 0 }]; // 3 -> 0 is not reachable
  const result = resolveRun({ g, ...noTraffic }, stops, [0, 1], car, 6 * 60, []);
  assert.equal(result, null);
});
