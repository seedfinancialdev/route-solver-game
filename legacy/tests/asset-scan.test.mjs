import test from 'node:test';
import assert from 'node:assert/strict';
import { referencesIn, classify } from '../scripts/lib/asset-scan.mjs';

test('finds a plain quoted reference', () => {
  assert.ok(referencesIn("fetch('data.json')").has('data.json'));
});

test('finds a reference with a cache-busting query and a relative prefix', () => {
  assert.ok(referencesIn('img.src = `../forest.webp?v=${v}`;').has('forest.webp'));
});

test('does not invent references that are not there', () => {
  assert.equal(referencesIn("fetch('data.json')").has('water.webp'), false);
});

test('an asset the entry point references is eager', () => {
  const out = classify({
    assets: ['index.html', 'app.js', 'data.json'],
    sources: new Map([
      ['index.html', '<script src="app.js"></script>'],
      ['app.js', "fetch('data.json')"],
    ]),
    entryPoints: ['index.html'],
    manifests: [],
  });
  assert.deepEqual(out.eager, ['app.js', 'data.json', 'index.html']);
  assert.deepEqual(out.orphan, []);
});

test('an unreachable subtree is orphaned even though its files reference each other', () => {
  const out = classify({
    assets: ['index.html', 'app.js', 'engine.js', 'map/map-engine.js', 'map/camera.js'],
    sources: new Map([
      ['index.html', '<script src="app.js"></script>'],
      ['app.js', "import x from './engine.js'"],
      ['engine.js', 'export const x = 1;'],
      ['map/map-engine.js', "import c from './camera.js'"],
      ['map/camera.js', 'export const c = 1;'],
    ]),
    entryPoints: ['index.html'],
    manifests: [],
  });
  assert.deepEqual(out.eager, ['app.js', 'engine.js', 'index.html']);
  assert.deepEqual(out.orphan, ['map/camera.js', 'map/map-engine.js']);
});

test('an asset provided by a reachable manifest is deferred, not orphan', () => {
  const out = classify({
    assets: ['index.html', 'terrain-tiles.json', 'terrain/0_0.webp'],
    sources: new Map([['index.html', "fetch('terrain-tiles.json')"]]),
    entryPoints: ['index.html'],
    manifests: [{ file: 'terrain-tiles.json', provides: ['terrain/0_0.webp'] }],
  });
  assert.deepEqual(out.eager, ['index.html', 'terrain-tiles.json']);
  assert.deepEqual(out.deferred, ['terrain/0_0.webp']);
  assert.deepEqual(out.orphan, []);
});

test('a manifest that is itself unreachable does not rescue what it provides', () => {
  const out = classify({
    assets: ['index.html', 'dead-manifest.json', 'dead/1.webp'],
    sources: new Map([['index.html', '<p>nothing here</p>']]),
    entryPoints: ['index.html'],
    manifests: [{ file: 'dead-manifest.json', provides: ['dead/1.webp'] }],
  });
  assert.deepEqual(out.eager, ['index.html']);
  assert.deepEqual(out.orphan, ['dead-manifest.json', 'dead/1.webp']);
});

test('two assets sharing a basename in different directories both resolve', () => {
  const out = classify({
    assets: ['index.html', 'a/x.json', 'b/x.json'],
    sources: new Map([['index.html', "fetch('a/x.json')"]]),
    entryPoints: ['index.html'],
    manifests: [],
  });
  // Basename matching cannot separate these, so both are treated as reachable.
  // Conservative on purpose: a false orphan would be worse than a missed one.
  assert.deepEqual(out.orphan, []);
});
