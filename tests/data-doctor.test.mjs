import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIPELINE, stalenessCheck, manifestAgreement, puzzleIndexCheck,
} from '../scripts/lib/dag.mjs';

test('the DAG records the fan-in through web/data.json', () => {
  const bundle = PIPELINE.find((s) => s.script === 'scripts/05-bundle.mjs');
  assert.ok(bundle, '05-bundle must be in the pipeline');
  assert.deepEqual(bundle.outputs, ['web/data.json']);
  for (const i of ['data/graph.json', 'data/map.json', 'data/puzzles.json', 'data/road-names.json']) {
    assert.ok(bundle.inputs.includes(i), `05-bundle must consume ${i}`);
  }
});

test('04-terrain consumes web/data.json, so it must run after 05-bundle', () => {
  const terrain = PIPELINE.find((s) => s.script === 'scripts/04-terrain.py');
  assert.ok(terrain.inputs.includes('web/data.json'));
});

test('staleness is reported when an output predates its input', () => {
  const stale = stalenessCheck(new Map([
    ['data/cities.json', 200],
    ['data/graph.json', 100],
  ]));
  assert.ok(stale.some((s) => s.output === 'data/graph.json' && s.input === 'data/cities.json'));
});

test('no staleness when outputs are newer than inputs', () => {
  const stale = stalenessCheck(new Map([
    ['data/cities.json', 100],
    ['data/graph.json', 200],
  ]));
  assert.equal(stale.some((s) => s.output === 'data/graph.json'), false);
});

test('a missing file is not reported as stale', () => {
  const stale = stalenessCheck(new Map([['data/cities.json', 100]]));
  assert.equal(stale.some((s) => s.output === 'data/graph.json'), false);
});

test('a duplicate output+input pair is reported only once', () => {
  // Historical regression test: web/cartography.json used to have two real
  // producers (08-cartography.mjs and 09-real-osm-forests.mjs), both fed by
  // web/data.json, which meant PIPELINE had two stages sharing the same
  // (output, input) pair and the staleness report repeated the line. 08 was
  // retired once 09 became the sole producer, so PIPELINE no longer has a
  // live duplicate to trigger this — the dedup logic in stalenessCheck stays
  // as a safeguard for the next time two stages legitimately share an output.
  const stale = stalenessCheck(new Map([
    ['web/data.json', 200],
    ['web/cartography.json', 100],
  ]));
  const matches = stale.filter((s) => s.output === 'web/cartography.json' && s.input === 'web/data.json');
  assert.equal(matches.length, 1);
});

test('manifest agreement catches a shifted index', () => {
  const r = manifestAgreement({ 0: 111, 1: 222 }, [{ geonameid: 111 }, { geonameid: 999 }]);
  assert.equal(r.checked, 2);
  assert.equal(r.agree, 1);
  assert.deepEqual(r.disagree, [{ index: 1, manifestGid: '222', graphGid: '999' }]);
});

test('manifest agreement flags an index past the end of the roster', () => {
  const r = manifestAgreement({ 5: 111 }, [{ geonameid: 111 }]);
  assert.deepEqual(r.disagree, [{ index: 5, manifestGid: '111', graphGid: 'missing' }]);
});

test('puzzle index check finds out-of-range references', () => {
  assert.deepEqual(puzzleIndexCheck([{ a: 0, b: 9 }, { a: 12, b: 1 }], 10), [12]);
});

test('puzzle index check passes a valid set', () => {
  assert.deepEqual(puzzleIndexCheck([{ a: 0, b: 9 }], 10), []);
});
