import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGraph } from '../web/engine.js';
import { bucketRoadRuns, TIER_MOTORWAY, TIER_TRUNK, TIER_PRIMARY } from '../web/map/road-tiers.js';

/** Two cities joined by one road, as buildGraph would leave it: same arrays both ways. */
function twoCityGraph(shape, pace) {
  const ab = { to: 1, shape, pace };
  const ba = { to: 0, shape, pace };
  return [[ab], [ba]];
}

test('tier 2 is the fastest road and draws as a motorway — never inverted', () => {
  const { motorways, trunks, primaries } = bucketRoadRuns(
    twoCityGraph([[0, 0], [1, 0]], [TIER_MOTORWAY, TIER_MOTORWAY]),
  );
  assert.equal(motorways.length, 1, 'tier 2 must land in motorways');
  assert.equal(trunks.length, 0);
  assert.equal(primaries.length, 0);
});

test('tier 1 draws as a trunk and tier 0 as a primary', () => {
  const trunkOnly = bucketRoadRuns(twoCityGraph([[0, 0], [1, 0]], [TIER_TRUNK, TIER_TRUNK]));
  assert.equal(trunkOnly.trunks.length, 1);
  assert.equal(trunkOnly.motorways.length, 0);

  const slowOnly = bucketRoadRuns(twoCityGraph([[0, 0], [1, 0]], [TIER_PRIMARY, TIER_PRIMARY]));
  assert.equal(slowOnly.primaries.length, 1);
  assert.equal(slowOnly.motorways.length, 0);
});

test('a mixed road contributes a run to each tier it actually contains', () => {
  // Five points, not four: a trailing run of a single point cannot be drawn and
  // is dropped, so the slow stretch needs two points to survive the split.
  const shape = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const { motorways, trunks, primaries } = bucketRoadRuns(twoCityGraph(shape, [2, 2, 1, 0, 0]));
  assert.equal(motorways.length, 1);
  assert.equal(trunks.length, 1);
  assert.equal(primaries.length, 1);
});

test('each road is bucketed once, not once per direction', () => {
  // buildGraph pushes the same road into both endpoints' adjacency lists.
  const { motorways } = bucketRoadRuns(twoCityGraph([[0, 0], [1, 0]], [2, 2]));
  assert.equal(motorways.length, 1, 'the same road must not be drawn twice');
});

test('roads too short to draw are skipped', () => {
  assert.deepEqual(bucketRoadRuns([[{ to: 1, shape: [[0, 0]], pace: [2] }], []]).motorways, []);
  assert.deepEqual(bucketRoadRuns([[{ to: 1, shape: null, pace: null }], []]).motorways, []);
  const empty = bucketRoadRuns(null);
  assert.deepEqual([empty.motorways, empty.trunks, empty.primaries], [[], [], []]);
});

test('on the real network no single bucket swallows the map', () => {
  // The defect this module replaces put 99.6% of edges in one bucket by reading
  // only each road's first segment, which is the slow exit from a city.
  const data = JSON.parse(readFileSync(new URL('../web/data.json', import.meta.url), 'utf8'));
  const { motorways, trunks, primaries } = bucketRoadRuns(buildGraph(data).adj);
  const total = motorways.length + trunks.length + primaries.length;

  assert.ok(total > 1000, `expected a populated network, got ${total} runs`);
  for (const [name, list] of [['motorways', motorways], ['trunks', trunks], ['primaries', primaries]]) {
    const share = list.length / total;
    assert.ok(share > 0.05, `${name} holds only ${(share * 100).toFixed(1)}% of runs — the tell has collapsed`);
    assert.ok(share < 0.90, `${name} holds ${(share * 100).toFixed(1)}% of runs — the tell has collapsed`);
  }
});
