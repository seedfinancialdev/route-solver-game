import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPaceRuns, roadRuns } from '../web/engine.js';

test('a single-tier road is one run covering every point', () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const runs = splitPaceRuns(pts, [1, 1, 1, 1]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tier, 1);
  assert.deepEqual(runs[0].pts, pts);
});

test('a road splits where the tier changes, and the runs overlap by a point', () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const runs = splitPaceRuns(pts, [2, 2, 0, 0]);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].tier, 2);
  assert.equal(runs[1].tier, 0);
  // The shared point is what keeps the drawn line unbroken.
  assert.deepEqual(runs[0].pts.at(-1), runs[1].pts[0]);
  assert.deepEqual(runs[0].pts, [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(runs[1].pts, [[2, 0], [3, 0]]);
});

test('every point survives the split', () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
  const pace = [0, 1, 1, 2, 2, 0];
  const runs = splitPaceRuns(pts, pace);
  const seen = new Set(runs.flatMap((r) => r.pts.map(([x, y]) => `${x},${y}`)));
  for (const [x, y] of pts) assert.ok(seen.has(`${x},${y}`), `point ${x},${y} was dropped`);
});

test('degenerate input yields no runs', () => {
  assert.deepEqual(splitPaceRuns([], []), []);
  assert.deepEqual(splitPaceRuns([[0, 0]], [1]), []);
  assert.deepEqual(splitPaceRuns(null, null), []);
});

test('a pace array shorter than pts throws instead of tiering the rest as undefined', () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0]];
  assert.throws(
    () => splitPaceRuns(pts, [2, 2]),
    /pace has 2 entries but pts has 4/,
  );
});

test('roadRuns still returns SVG path strings, oriented from the given city', () => {
  const edge = { shape: [[0, 0], [1, 0], [2, 0], [3, 0]], pace: [2, 2, 0, 0] };
  const a = { x: 0, y: 0 };
  const b = { x: 3, y: 0 };

  const forward = roadRuns(edge, a, b);
  assert.equal(forward.length, 2);
  assert.equal(forward[0].tier, 2);
  assert.ok(forward[0].d.startsWith('M0 0'), `expected to start at city a, got ${forward[0].d}`);

  // Driven the other way, the road reverses and so does its pace.
  const back = roadRuns(edge, b, a);
  assert.equal(back[0].tier, 0);
  assert.ok(back[0].d.startsWith('M3 0'), `expected to start at city b, got ${back[0].d}`);
});
