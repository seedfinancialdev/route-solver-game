import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidates } from '../blind-map/candidates.mjs';

// A tiny graph, shaped exactly like loadGraph()'s return value, small enough
// to reason about by hand. Node 0: out-degree 4, touching classes
// {motorway=0, primary=1} -- a real interchange. Node 1: out-degree 3,
// touching class {tertiary=2} only -- an ordinary crossroads. Node 2:
// out-degree 2 -- below minDegree, must be excluded. Nodes 3-5: out-degree 0.
function makeGraph() {
  const classes = ['motorway', 'primary', 'tertiary'];
  const n = 6;
  const xy = new Float32Array([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  const off = Uint32Array.from([0, 4, 7, 9, 9, 9, 9]);
  const to = Int32Array.from([3, 4, 3, 4, 3, 4, 3, 4, 5]);
  const cls = Uint8Array.from([0, 0, 1, 1, 2, 2, 2, 1, 1]);
  const via = Uint32Array.from(cls.map((_, i) => i));
  return { n, e: cls.length, off, to, via, cls, xy, meta: { classes } };
}

test('excludes nodes below minDegree', () => {
  const g = makeGraph();
  const candidates = pickCandidates(g, { count: 10, minDegree: 3 });
  assert.ok(!candidates.some((c) => c.node === 2));
});

test('includes qualifying junctions, tagged with the classes touching them', () => {
  const g = makeGraph();
  const candidates = pickCandidates(g, { count: 10, minDegree: 3 });
  const byNode = new Map(candidates.map((c) => [c.node, c]));
  assert.deepEqual(byNode.get(0).classes, ['motorway', 'primary']);
  assert.deepEqual(byNode.get(1).classes, ['tertiary']);
});

test('stops once `count` distinct class-signatures are found', () => {
  const g = makeGraph();
  const candidates = pickCandidates(g, { count: 1, minDegree: 3 });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].node, 0); // first qualifying node, scanned in index order
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
