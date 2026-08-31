// tests/blind-map-candidates-output.test.mjs
//
// Checks the shape and diversity of the COMMITTED candidates.json, not a
// fresh run against the 772MB graph — Task 2's tests already cover
// pickCandidates()'s logic against a fast synthetic fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// _link variants map to their parent class's style bucket — see
// blind-map/candidates.mjs's styleBucket. Not expected in this file (real
// junctions with real out-degree rarely sit exactly on a link segment), but
// handled for correctness if one ever does.
const LINK_PARENT = {
  motorway_link: 'motorway', trunk_link: 'trunk', primary_link: 'primary',
  secondary_link: 'secondary', tertiary_link: 'tertiary',
};
const styleBucket = (rawClass) => LINK_PARENT[rawClass] || rawClass;

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

test('at least one committed candidate touches a motorway- or trunk-class road', () => {
  // Guaranteed by construction (pickCandidates prefers a motorway/trunk-
  // touching candidate when one is reachable under the other constraints),
  // and confirmed present in the real graph — see build-blind-map-candidates.
  const candidates = JSON.parse(readFileSync(new URL('../blind-map/candidates.json', import.meta.url), 'utf8'));
  const hasMajor = candidates.some((c) => c.classes.some((cls) => {
    const bucket = styleBucket(cls);
    return bucket === 'motorway' || bucket === 'trunk';
  }));
  assert.ok(hasMajor, 'expected at least one candidate touching a motorway- or trunk-class road');
});

test('committed candidates have real geographic separation (no two within 20km)', () => {
  const candidates = JSON.parse(readFileSync(new URL('../blind-map/candidates.json', import.meta.url), 'utf8'));
  const distanceKm = (a, b) => {
    const midLatRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const dx = (b.lon - a.lon) * Math.cos(midLatRad) * 111.32;
    const dy = (b.lat - a.lat) * 111;
    return Math.sqrt(dx * dx + dy * dy);
  };
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      assert.ok(
        distanceKm(candidates[i], candidates[j]) >= 20,
        `candidates ${i} and ${j} are within 20km of each other`,
      );
    }
  }
});
