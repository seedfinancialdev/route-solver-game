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
import { carMinutes, resolveRun, edgeLine, resolveLegWithWaypoint } from '../scripts/lib/resolve.mjs';

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
    xy: Float32Array.from([0, 0, 1, 0, 2, 0, 3, 0]),  // four nodes, due east, one degree apart
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

// ---- route geometry, for drawing what actually got resolved ----------------
//
// The graph stores no shapes, only junction positions (same caveat as
// scripts/19-run-geometry.mjs) — a resolved route is straight lines between
// junctions. Good enough to show a player what road their plan actually
// took; not survey-accurate close up.

test('edgeLine traces one point per edge start, plus the final destination', () => {
  const g = lineGraph();
  const coords = edgeLine(g, [0, 1, 2]); // the whole line, node 0 -> node 3
  assert.deepEqual(coords, [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('edgeLine on a single edge is just its two endpoints', () => {
  const g = lineGraph();
  assert.deepEqual(edgeLine(g, [1]), [[1, 0], [2, 0]]);
});

test('resolveRun attaches real coordinates to each leg', () => {
  const g = lineGraph();
  const car = { topKmh: 250 };
  const stops = [{ name: 'A', node: 0 }, { name: 'B', node: 2 }, { name: 'C', node: 3 }];
  const result = resolveRun({ g, ...noTraffic }, stops, [0, 1, 2], car, 6 * 60, []);
  assert.deepEqual(result.legs[0].coordinates, [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(result.legs[1].coordinates, [[2, 0], [3, 0]]);
});

// ---- routing through a dragged waypoint ------------------------------------
//
// This is the mechanism behind "drag the route like Google Maps": force a
// leg through a specific point instead of taking the default fastest path.
// A diamond graph — a short direct path and a longer alternate — is the
// smallest fixture that can actually prove a forced waypoint changes the
// path, not just relabels the same one.
//
//      1
//    ↗   ↘
//   0      3     0->1->3 short (100 km); 0->2->3 long (160 km)
//    ↘   ↗
//      2
function diamondGraph() {
  return {
    meta: { flags: { oneway: 1, maxspeedReal: 4 }, classes: ['motorway'] },
    n: 4,
    e: 4,
    a: Int32Array.from([0, 1, 0, 2]),
    b: Int32Array.from([1, 3, 2, 3]),
    m: Uint32Array.from([50000, 50000, 80000, 80000]),
    kmh: Uint8Array.from([100, 100, 100, 100]),
    cls: Uint8Array.from([0, 0, 0, 0]),
    flags: Uint8Array.from([4, 4, 4, 4]),
    xy: Float32Array.from([0, 0, 1, 0, 0, 1, 2, 0]),  // 0=(0,0) 1=(1,0) 2=(0,1) 3=(2,0)
    off: Uint32Array.from([0, 2, 3, 4, 4]),
    to: Int32Array.from([1, 2, 3, 3]),
    via: Uint32Array.from([0, 2, 1, 3]),
    // junctionNode()/nearestNode() need the grid index loadGraph() normally
    // builds — one cell per node here is enough for these tests' clicks.
    cell: 1,
    grid: new Map([['0:0', [0]], ['1:0', [1]], ['0:1', [2]], ['2:0', [3]]]),
  };
}

test('resolveRun takes the short direct path when nothing forces a detour', () => {
  const g = diamondGraph();
  const car = { topKmh: 176 };
  const stops = [{ name: 'Start', node: 0 }, { name: 'End', node: 3 }];
  const result = resolveRun({ g, ...noTraffic }, stops, [0, 1], car, 6 * 60, []);
  assert.equal(result.legs[0].km, 100);
});

test('resolveLegWithWaypoint routes through the forced point even when it is not on the fast path', () => {
  const g = diamondGraph();
  const car = { topKmh: 176 };
  const from = { name: 'Start', node: 0 }, to = { name: 'End', node: 3 };
  const detour = resolveLegWithWaypoint({ g, ...noTraffic }, from, to, [0, 1], car, 6 * 60, []);
  assert.equal(detour.km, 160, 'should take the long way, via node 2, not the short direct path');
});

test('resolveLegWithWaypoint costs more than the undetoured leg when the forced point is out of the way', () => {
  const g = diamondGraph();
  const car = { topKmh: 176 };
  const stops = [{ name: 'Start', node: 0 }, { name: 'End', node: 3 }];
  const direct = resolveRun({ g, ...noTraffic }, stops, [0, 1], car, 6 * 60, []);
  const detour = resolveLegWithWaypoint({ g, ...noTraffic }, stops[0], stops[1], [0, 1], car, 6 * 60, []);
  assert.ok(detour.minutes > direct.legs[0].minutes);
});

test('resolveLegWithWaypoint traces real coordinates through the waypoint, with no duplicate at the join', () => {
  const g = diamondGraph();
  const car = { topKmh: 176 };
  const from = { name: 'Start', node: 0 }, to = { name: 'End', node: 3 };
  const detour = resolveLegWithWaypoint({ g, ...noTraffic }, from, to, [0, 1], car, 6 * 60, []);
  assert.deepEqual(detour.coordinates, [[0, 0], [0, 1], [2, 0]]);
});

test('resolveLegWithWaypoint snaps a raw click near a junction to that junction', () => {
  const g = diamondGraph();
  const car = { topKmh: 176 };
  const from = { name: 'Start', node: 0 }, to = { name: 'End', node: 3 };
  // Click slightly off node 2's exact position (0, 1), but within its own grid
  // cell (cell size 1) so this tests snapping itself, not nearestNode's
  // separate cross-cell ring search, which road-graph.test.mjs already covers.
  const detour = resolveLegWithWaypoint({ g, ...noTraffic }, from, to, [0.05, 1.05], car, 6 * 60, []);
  assert.equal(detour.km, 160);
});

test('resolveLegWithWaypoint still applies a matching incident to the whole leg', () => {
  const g = diamondGraph();
  const car = { topKmh: 176 };
  const from = { name: 'Start', node: 0 }, to = { name: 'End', node: 3 };
  const detour = resolveLegWithWaypoint({ g, ...noTraffic }, from, to, [0, 1], car, 6 * 60,
    [{ from: 'Start', to: 'End', delayMinutes: 20, note: 'test' }]);
  assert.equal(detour.incidentMinutes, 20);
});

test('resolveLegWithWaypoint returns null when the forced point cannot reach the destination', () => {
  const g = diamondGraph();
  g.off = Uint32Array.from([0, 2, 3, 3, 4]); // node 2 now has no outgoing edge
  const car = { topKmh: 176 };
  const from = { name: 'Start', node: 0 }, to = { name: 'End', node: 3 };
  const detour = resolveLegWithWaypoint({ g, ...noTraffic }, from, to, [0, 1], car, 6 * 60, []);
  assert.equal(detour, null);
});
