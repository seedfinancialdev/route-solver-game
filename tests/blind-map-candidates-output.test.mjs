// tests/blind-map-candidates-output.test.mjs
//
// Checks the shape and diversity of the COMMITTED candidates.json, not a
// fresh run against the 772MB graph — Task 2's tests already cover
// pickCandidates()'s logic against a fast synthetic fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the committed candidates.json is well-formed and diverse', () => {
  const candidates = JSON.parse(readFileSync(new URL('../blind-map/candidates.json', import.meta.url), 'utf8'));
  assert.ok(candidates.length >= 4, 'expect at least a handful of candidates');
  for (const c of candidates) {
    assert.equal(typeof c.lon, 'number');
    assert.equal(typeof c.lat, 'number');
    assert.ok(c.lon >= -180 && c.lon <= 180);
    assert.ok(c.lat >= -90 && c.lat <= 90);
    assert.ok(Array.isArray(c.classes) && c.classes.length >= 1);
  }
  const signatures = new Set(candidates.map((c) => c.classes.join(',')));
  assert.equal(signatures.size, candidates.length, 'every candidate should have a distinct class signature');
});
