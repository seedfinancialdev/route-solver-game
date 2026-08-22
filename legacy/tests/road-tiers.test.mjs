import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGraph } from '../web/engine.js';
import { bucketRoadRuns, TIER_FAST, TIER_ORDINARY, TIER_SLOW } from '../web/map/road-tiers.js';

// These buckets hold PACE, not road class. They were once called motorways /
// trunks / primaries, which made a slow mountain stretch of a real motorway
// bucket as a "primary" — a road-class word stating a speed. Those names are
// reserved for actual OSM road class, which is a separate variable.

/** Two cities joined by one road, as buildGraph would leave it: same arrays both ways. */
function twoCityGraph(shape, pace) {
  const ab = { to: 1, shape, pace };
  const ba = { to: 0, shape, pace };
  return [[ab], [ba]];
}

test('tier 2 is the fastest stretch and buckets as fast — never inverted', () => {
  const { fast, ordinary, slow } = bucketRoadRuns(
    twoCityGraph([[0, 0], [1, 0]], [TIER_FAST, TIER_FAST]),
  );
  assert.equal(fast.length, 1, 'tier 2 must land in the fast bucket');
  assert.equal(ordinary.length, 0);
  assert.equal(slow.length, 0);
});

test('tier 1 buckets as ordinary and tier 0 as slow', () => {
  const ordinaryOnly = bucketRoadRuns(twoCityGraph([[0, 0], [1, 0]], [TIER_ORDINARY, TIER_ORDINARY]));
  assert.equal(ordinaryOnly.ordinary.length, 1);
  assert.equal(ordinaryOnly.fast.length, 0);

  const slowOnly = bucketRoadRuns(twoCityGraph([[0, 0], [1, 0]], [TIER_SLOW, TIER_SLOW]));
  assert.equal(slowOnly.slow.length, 1);
  assert.equal(slowOnly.fast.length, 0);
});

test('a mixed road contributes a run to each tier it actually contains', () => {
  // Five points, not four: a trailing run of a single point cannot be drawn and
  // is dropped, so the slow stretch needs two points to survive the split.
  const shape = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const { fast, ordinary, slow } = bucketRoadRuns(twoCityGraph(shape, [2, 2, 1, 0, 0]));
  assert.equal(fast.length, 1);
  assert.equal(ordinary.length, 1);
  assert.equal(slow.length, 1);
});

test('each road is bucketed once, not once per direction', () => {
  // buildGraph pushes the same road into both endpoints' adjacency lists.
  const { fast } = bucketRoadRuns(twoCityGraph([[0, 0], [1, 0]], [2, 2]));
  assert.equal(fast.length, 1, 'the same road must not be drawn twice');
});

test('roads too short to draw are skipped', () => {
  assert.deepEqual(bucketRoadRuns([[{ to: 1, shape: [[0, 0]], pace: [2] }], []]).fast, []);
  assert.deepEqual(bucketRoadRuns([[{ to: 1, shape: null, pace: null }], []]).fast, []);
  const empty = bucketRoadRuns(null);
  assert.deepEqual([empty.fast, empty.ordinary, empty.slow], [[], [], []]);
});

test('a malformed tier value throws instead of silently drawing as the slowest', () => {
  // Any tier that isn't 2 (fast), 1 (ordinary), or 0 (slow) is malformed data.
  // It must fail loudly, not fall through a bare `else` into the slow bucket —
  // that's exactly how the map would silently lie about the whole network.
  const graph = twoCityGraph([[0, 0], [1, 0]], [5, 5]);
  assert.throws(
    () => bucketRoadRuns(graph),
    /unexpected pace tier 5/,
  );
});

test('a short pace array is not swallowed either — it propagates as a thrown error', () => {
  const graph = twoCityGraph([[0, 0], [1, 0], [2, 0]], [TIER_FAST, TIER_FAST]);
  assert.throws(() => bucketRoadRuns(graph), /pace has 2 entries but pts has 3/);
});

test('on the real network no single bucket swallows the map', () => {
  // The defect this module replaces put 99.6% of edges in one bucket by reading
  // only each road's first segment, which is the slow exit from a city.
  const data = JSON.parse(readFileSync(new URL('../web/data.json', import.meta.url), 'utf8'));
  const { fast, ordinary, slow } = bucketRoadRuns(buildGraph(data).adj);
  const total = fast.length + ordinary.length + slow.length;

  assert.ok(total > 1000, `expected a populated network, got ${total} runs`);
  for (const [name, list] of [['fast', fast], ['ordinary', ordinary], ['slow', slow]]) {
    const share = list.length / total;
    assert.ok(share > 0.05, `${name} holds only ${(share * 100).toFixed(1)}% of runs — the tell has collapsed`);
    assert.ok(share < 0.90, `${name} holds ${(share * 100).toFixed(1)}% of runs — the tell has collapsed`);
  }
});
