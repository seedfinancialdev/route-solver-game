import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidates } from '../blind-map/candidates.mjs';

// A tiny graph, shaped exactly like loadGraph()'s return value, small enough
// to reason about by hand.
//
// Class ids: 0 motorway, 1 trunk, 2 primary, 3 secondary, 4 tertiary,
// 5 unclassified, 6 residential — unclassified/residential both map to the
// style's single "minor" bucket (see candidates.mjs's styleBucket).
//
// Node 0 (0, 0): out-degree 4, touches {primary, tertiary} — two distinct
//   style buckets, qualifies.
// Node 1 (5, 5): out-degree 3, touches {unclassified, residential} — two
//   RAW classes but both map to "minor", so only one style bucket. Must be
//   rejected: nothing to rank at a junction where every branch renders
//   identically.
// Node 2 (10, 10): out-degree 2 — below minDegree, must be excluded.
// Node 3 (0.05, 0.05): out-degree 3, touches {secondary, residential} — two
//   style buckets, but ~7.9km from node 0, inside the 20km separation floor.
//   Must be rejected even though its signature is new.
// Node 4 (1, 1): out-degree 3, touches {secondary, residential} — the SAME
//   signature as node 3, but ~157km from node 0. Must be accepted: node 3's
//   rejection (for distance) must not have "used up" that signature.
// Node 5 (2, 2): out-degree 3, touches {motorway, primary} — ~315km from
//   node 0 and ~157km from node 4, clear of both.
function makeGraph() {
  const classes = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'];
  const n = 6;
  const xy = Float32Array.from([0, 0, 5, 5, 10, 10, 0.05, 0.05, 1, 1, 2, 2]);
  //                         node0   node1  node2  node3     node4  node5
  const cls = Uint8Array.from([
    2, 2, 4, 4,   // node 0: primary, tertiary
    5, 6, 5,      // node 1: unclassified, residential (both -> minor)
    2, 3,         // node 2: degree 2, below threshold
    3, 6, 3,      // node 3: secondary, residential
    3, 3, 6,      // node 4: secondary, residential (same signature as node 3)
    0, 2, 0,      // node 5: motorway, primary
  ]);
  const off = Uint32Array.from([0, 4, 7, 9, 12, 15, 18]);
  const via = Uint32Array.from(cls.map((_, i) => i));
  const to = new Int32Array(cls.length); // unused by pickCandidates, kept for shape fidelity
  return { n, e: cls.length, off, to, via, cls, xy, meta: { classes } };
}

test('excludes nodes below minDegree', () => {
  const g = makeGraph();
  const candidates = pickCandidates(g, { count: 10, minDegree: 3 });
  assert.ok(!candidates.some((c) => c.node === 2));
});

test('includes qualifying junctions, tagged with the raw classes touching them', () => {
  const g = makeGraph();
  const candidates = pickCandidates(g, { count: 10, minDegree: 3 });
  const byNode = new Map(candidates.map((c) => [c.node, c]));
  assert.deepEqual(byNode.get(0).classes, ['primary', 'tertiary']);
  assert.deepEqual(byNode.get(5).classes, ['motorway', 'primary']);
});

test('rejects a junction whose mapped style-bucket signature has only one distinct class, even with multiple raw classes', () => {
  const g = makeGraph();
  const candidates = pickCandidates(g, { count: 10, minDegree: 3 });
  // node 1 touches two raw classes (unclassified, residential) but both
  // render in the style's single "minor" bucket — nothing to rank.
  assert.ok(!candidates.some((c) => c.node === 1));
});

test('rejects a candidate within minSeparationKm of an already-accepted candidate', () => {
  const g = makeGraph();
  const candidates = pickCandidates(g, { count: 10, minDegree: 3, minSeparationKm: 20 });
  assert.ok(!candidates.some((c) => c.node === 3), 'node 3 is ~7.9km from accepted node 0');
});

test('a later candidate with the same signature as a too-close rejection is still eligible', () => {
  const g = makeGraph();
  const candidates = pickCandidates(g, { count: 10, minDegree: 3, minSeparationKm: 20 });
  // node 4 shares node 3's signature but is ~157km from node 0 — node 3's
  // distance-rejection must not have marked that signature as used up.
  assert.ok(candidates.some((c) => c.node === 4));
});

test('prefers including a motorway/trunk-touching candidate even beyond `count`, if the graph has one reachable under the other constraints', () => {
  const g = makeGraph();
  // count: 2 fills up on node 0 and node 4 before node 5 (motorway) is ever
  // scanned — without the preference, node 5 would never make it in.
  const candidates = pickCandidates(g, { count: 2, minDegree: 3, minSeparationKm: 20 });
  assert.equal(candidates.length, 3, 'node 5 is added as a preferred extra beyond count');
  assert.ok(candidates.some((c) => c.node === 5));
});

test('is deterministic — calling it twice returns the same result', () => {
  const g = makeGraph();
  assert.deepEqual(pickCandidates(g), pickCandidates(g));
});

test('carries real coordinates through from the graph', () => {
  const g = makeGraph();
  const [first] = pickCandidates(g, { count: 1, minDegree: 3 });
  assert.equal(first.lon, 0);
  assert.equal(first.lat, 0);
});
