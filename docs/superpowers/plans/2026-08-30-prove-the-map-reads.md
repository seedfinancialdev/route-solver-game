# Prove The Map Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone test harness — `blind-map/` — that shows a real
road junction inside a fixed ~300m visibility radius, with no place/road
labels, so the "prove the map reads" gate in the new design-intent doc can
actually be run with real people before anything else gets built.

**Architecture:** A trimmed fork of `legacy/atlas/style.js` (road class,
terrain, water — no labels, no atlas-specific layers) rendered by MapLibre GL
JS at a fixed, non-interactive zoom, centered on one of a small set of real
junctions picked from `data/road-graph/`. The fog-of-war radius is a CSS
radial-gradient overlay sized in pixels by a small Web Mercator conversion,
not a map layer — simpler than a GeoJSON polygon-with-a-hole, and correct
because the harness never pans or zooms, so the junction is always dead
center.

**Tech Stack:** Vanilla ES modules, MapLibre GL JS (vendored, no CDN,
copied from `legacy/atlas/vendor/` rather than imported from it — nothing in
new code depends on `legacy/`), `node:http` for serving, `node:test` +
`node:assert/strict` for tests. No npm dependencies added.

**Spec:** `docs/superpowers/specs/2026-08-30-design-intent.md`, specifically
"The cartographic brief" implied by pillar 5, "The loop" (the ~300m radius),
and "Build sequence" step 2: *"Prove the map reads. Label-stripped style,
fog-of-war radius, tested against: at a junction, can a person identify the
branches and form a hypothesis about which leads toward the objective, and
why? Run with real people before building anything downstream."*

## Global Constraints

- **Fog-of-war radius is ~300m** — spec's "The loop" section. Starting value,
  expected to be visually tuned once a human actually looks at it; the exact
  pixel size is not something to compute your way to a "correct" answer for.
- **Never rely on a single visual channel for load-bearing information**
  (spec's "What this replaces" → Retained list). Road class must carry both
  colour AND width, never colour alone — the forked style keeps both
  `CLASS_COLOUR` and `CLASS_WIDTH` unchanged from the original.
- **No randomness anywhere** (spec pillar 4). Candidate junction selection
  must be deterministic — same input graph, same output every time.
- **No npm dependencies added.** Vanilla ES modules; MapLibre is vendored,
  not installed.
- **This harness does not test signs, sun-shadow, or an objective** — those
  are later build-sequence phases. Don't scope-creep the test protocol
  beyond what design-intent.md's Phase 2 actually asks for: branch geometry
  and road class legibility, nothing else.
- **`npm test` must pass before every commit.** Tests are ESM `.mjs` under
  `tests/`, run by `node --test 'tests/**/*.test.mjs'`.
- **A MapLibre style that fails validation renders nothing** — background
  included — with only a console message as the symptom (established in
  `legacy/atlas/check-style.mjs`'s own docstring). `node blind-map/check-style.mjs`
  must exit 0 before the style is considered correct.
- **Nothing in `blind-map/` or `scripts/` imports from `legacy/`.** New work
  builds forward from the shared substrate (`data/`, `scripts/lib/road-graph.mjs`),
  never from retired code — same discipline the retirement itself established.

---

## File Structure

```
blind-map/
  candidates.mjs           pure function: pick diverse real junctions from a graph
  candidates.json           committed output of the generator below (8 junctions)
  style.js                  trimmed MapLibre style: road class, terrain, water — no labels
  check-style.mjs            style validator, forked from legacy/atlas/check-style.mjs
  fog-radius.mjs              pure function: real-world meters -> screen pixels
  index.html                   the harness page
  blind-gl.js                   page controller: loads a candidate, applies the fog overlay
  vendor/
    maplibre-gl.js               copied from legacy/atlas/vendor/ (not imported from it)
    maplibre-gl.css
  README.md                     the test protocol
scripts/
  build-blind-map-candidates.mjs   generates blind-map/candidates.json from data/road-graph/
  serve-blind-map.mjs               minimal static server for blind-map/
tests/
  fog-radius.test.mjs
  candidates.test.mjs
  blind-map-candidates-output.test.mjs
```

---

### Task 1: Fog-of-war radius math

**Files:**
- Create: `blind-map/fog-radius.mjs`
- Test: `tests/fog-radius.test.mjs`

**Interfaces:**
- Produces: `metersPerPixel(lat, zoom): number` and `metersToPixels(meters, lat, zoom): number`, both from `blind-map/fog-radius.mjs`. Consumed by Task 5's `blind-map/blind-gl.js`.

- [ ] **Step 1: Create the directory and write the failing test**

```bash
mkdir -p blind-map tests
```

```javascript
// tests/fog-radius.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metersPerPixel, metersToPixels } from '../blind-map/fog-radius.mjs';

test('at the equator, zoom 0, meters-per-pixel matches the known Web Mercator reference value', () => {
  const mpp = metersPerPixel(0, 0);
  assert.ok(Math.abs(mpp - 156543.03392) < 0.001);
});

test('meters per pixel halves for each zoom level increase, at fixed latitude', () => {
  const z10 = metersPerPixel(45, 10);
  const z11 = metersPerPixel(45, 11);
  assert.ok(Math.abs(z11 - z10 / 2) < 1e-6);
});

test('meters per pixel shrinks moving away from the equator, at fixed zoom', () => {
  const equator = metersPerPixel(0, 12);
  const midLat = metersPerPixel(50, 12);
  assert.ok(midLat < equator);
});

test('metersToPixels grows as zoom increases, for a fixed real-world radius', () => {
  const near = metersToPixels(300, 52, 15);
  const far = metersToPixels(300, 52, 17);
  assert.ok(far > near);
});

test('metersToPixels is the inverse of metersPerPixel by construction', () => {
  const mpp = metersPerPixel(40, 14);
  const px = metersToPixels(300, 40, 14);
  assert.ok(Math.abs(px * mpp - 300) < 1e-6);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/fog-radius.test.mjs`
Expected: FAIL — `Cannot find module '../blind-map/fog-radius.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// blind-map/fog-radius.mjs
//
// Converts a real-world radius (meters) into a screen-pixel radius at a
// given map center latitude and zoom, using the standard Web Mercator
// meters-per-pixel formula. The fog-of-war overlay is CSS, not a map layer
// (see blind-gl.js) — it needs this to know how many pixels 300m is before
// it can draw a hole that size.

const EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 = 156543.03392;

/** Real-world meters represented by one screen pixel, at this latitude and
 * zoom. Mercator projection stretches the map east-west away from the
 * equator, so the same zoom level represents fewer real meters per pixel at
 * higher latitudes — moving toward a pole makes a fixed pixel span "more
 * real ground" in appearance but actually cover fewer real meters. */
export function metersPerPixel(lat, zoom) {
  return (EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / (2 ** zoom);
}

/** Screen-pixel radius that represents `meters` of real-world distance at
 * this latitude and zoom. */
export function metersToPixels(meters, lat, zoom) {
  return meters / metersPerPixel(lat, zoom);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/fog-radius.test.mjs`
Expected: PASS — 5 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add blind-map/fog-radius.mjs tests/fog-radius.test.mjs
git commit -m "feat(blind-map): fog-of-war radius conversion (meters -> pixels)"
```

---

### Task 2: Candidate junction picker

**Files:**
- Create: `blind-map/candidates.mjs`
- Test: `tests/candidates.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks. Operates on a graph object shaped exactly like `scripts/lib/road-graph.mjs`'s `loadGraph()` return value — `{ n, e, off, to, via, cls, xy, meta: { classes } }` — without importing `loadGraph` itself (kept a pure function, testable without the real 772MB graph).
- Produces: `pickCandidates(g, { count = 6, minDegree = 3 } = {}): [{ node, lon, lat, classes }]`, from `blind-map/candidates.mjs`. Consumed by Task 3's `scripts/build-blind-map-candidates.mjs`.

- [ ] **Step 1: Write the failing test, against a small synthetic graph fixture**

```javascript
// tests/candidates.test.mjs
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/candidates.test.mjs`
Expected: FAIL — `Cannot find module '../blind-map/candidates.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// blind-map/candidates.mjs
//
// Picks a small, deterministic set of real junctions to show a tester during
// the map-legibility check — design-intent.md's "prove the map reads" gate.
// Diverse by road class, so the test covers a motorway interchange and an
// ordinary crossroads rather than six copies of the same kind of junction.
// Scans in node-index order and stops once enough distinct class-signatures
// are found — deterministic, no randomness (spec pillar 4).

/**
 * @param g          a graph as returned by scripts/lib/road-graph.mjs's loadGraph()
 * @param count      how many candidates to return
 * @param minDegree  the same junction threshold junctionNode() uses — excludes
 *                   cul-de-sacs and mid-block nodes, so every candidate is a
 *                   real decision point
 * @returns [{ node, lon, lat, classes }] — classes is the sorted, deduplicated
 *          set of road class names touching this junction
 */
export function pickCandidates(g, { count = 6, minDegree = 3 } = {}) {
  const bySignature = new Map();
  for (let node = 0; node < g.n; node++) {
    const degree = g.off[node + 1] - g.off[node];
    if (degree < minDegree) continue;
    const classIds = new Set();
    for (let k = g.off[node]; k < g.off[node + 1]; k++) classIds.add(g.cls[g.via[k]]);
    const sortedIds = [...classIds].sort((a, b) => a - b);
    const signature = sortedIds.join(',');
    if (!bySignature.has(signature)) {
      bySignature.set(signature, {
        node,
        lon: g.xy[2 * node],
        lat: g.xy[2 * node + 1],
        classes: sortedIds.map((c) => g.meta.classes[c]),
      });
    }
    if (bySignature.size >= count) break;
  }
  return [...bySignature.values()];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/candidates.test.mjs`
Expected: PASS — 5 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add blind-map/candidates.mjs tests/candidates.test.mjs
git commit -m "feat(blind-map): deterministic diverse-junction picker"
```

---

### Task 3: Generate the real candidate set

**Files:**
- Create: `scripts/build-blind-map-candidates.mjs`
- Create (generated, committed): `blind-map/candidates.json`
- Test: `tests/blind-map-candidates-output.test.mjs`
- Modify: `package.json` (add `blind-map:candidates` script)

**Interfaces:**
- Consumes: `pickCandidates` from Task 2; `loadGraph` from `scripts/lib/road-graph.mjs` (existing, unmodified).
- Produces: `blind-map/candidates.json` — `[{ lon: number, lat: number, classes: string[] }]`. Consumed by Task 5's `blind-map/blind-gl.js` via `fetch('candidates.json')`.

- [ ] **Step 1: Write the generator script**

```javascript
// scripts/build-blind-map-candidates.mjs
//
// Generates blind-map/candidates.json from the real road graph — the small,
// hand-curated set of junctions the map-legibility test cycles through. Not
// the automated destination-first generator (that's a later build-sequence
// phase); this is just "find a few real, diverse junctions to look at."
//
// Usage: node scripts/build-blind-map-candidates.mjs

import { writeFileSync } from 'node:fs';
import { loadGraph } from './lib/road-graph.mjs';
import { pickCandidates } from '../blind-map/candidates.mjs';

const g = loadGraph('data/road-graph');
const candidates = pickCandidates(g, { count: 8, minDegree: 3 });
const out = candidates.map(({ lon, lat, classes }) => ({ lon, lat, classes }));
writeFileSync(
  new URL('../blind-map/candidates.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`wrote ${out.length} candidates to blind-map/candidates.json`);
```

- [ ] **Step 2: Add the npm script**

Add to `package.json`'s `"scripts"` object (alongside the existing `osm:build` entry):

```json
"blind-map:candidates": "node scripts/build-blind-map-candidates.mjs",
```

- [ ] **Step 3: Run it against the real graph**

Run: `npm run blind-map:candidates`
Expected: `wrote 8 candidates to blind-map/candidates.json`, and the file exists at `blind-map/candidates.json`.

- [ ] **Step 4: Write and run the output test**

```javascript
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
```

Run: `node --test tests/blind-map-candidates-output.test.mjs`
Expected: PASS — 1 test, 0 failures

- [ ] **Step 5: Commit**

```bash
git add scripts/build-blind-map-candidates.mjs blind-map/candidates.json tests/blind-map-candidates-output.test.mjs package.json
git commit -m "feat(blind-map): generate the real candidate junction set"
```

---

### Task 4: The trimmed style, and its validator

**Files:**
- Create: `blind-map/style.js`
- Create: `blind-map/check-style.mjs`
- Modify: `package.json` (add `blind-map:check` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `blind-map/style.js` sets `window.BLIND_MAP_STYLE` (browser) or exports `{ style }` (node). Consumed by Task 5's `blind-map/index.html` (loaded as a plain script) and `blind-map/blind-gl.js` (reads `window.BLIND_MAP_STYLE`).

- [ ] **Step 1: Write the style validator**

```javascript
// blind-map/check-style.mjs
//
// Validates the blind-map style in node, before a browser ever sees it.
// Forked from legacy/atlas/check-style.mjs — same failure mode applies here:
// a style that fails validation is rejected WHOLE, and the only symptom is a
// console message.
//
// The original's route-specific "pace tell" check is dropped — this style
// has no routes source and no pace-tiered line-width arrays to check the
// ordering of.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('./style.js', import.meta.url), 'utf8'), sandbox);
const style = sandbox.window.BLIND_MAP_STYLE;
if (!style) { console.error('style.js did not set window.BLIND_MAP_STYLE'); process.exit(1); }

const problems = [];
const ZOOM_HOSTS = new Set(['interpolate', 'interpolate-hcl', 'interpolate-lab', 'step']);

const isExpr = (v) => Array.isArray(v) && typeof v[0] === 'string';
const isZoom = (v) => Array.isArray(v) && v.length === 1 && v[0] === 'zoom';

function findZoom(node, path, where) {
  if (isZoom(node)) { problems.push(`${where}: ["zoom"] nested at ${path} — legal only as the input to a TOP-LEVEL step/interpolate`); return; }
  if (!Array.isArray(node)) return;
  node.forEach((child, i) => findZoom(child, `${path}[${i}]`, where));
}

function checkProperty(value, where) {
  if (!isExpr(value)) { findZoom(value, 'value', where); return; }
  if (ZOOM_HOSTS.has(value[0])) {
    const inputIndex = value[0] === 'step' ? 1 : 2;
    value.forEach((child, i) => {
      if (i === 0) return;
      if (i === inputIndex && isZoom(child)) return;
      findZoom(child, `[${i}]`, where);
    });
    return;
  }
  findZoom(value, 'value', where);
}

const ids = new Set();
for (const layer of style.layers) {
  if (ids.has(layer.id)) problems.push(`duplicate layer id: ${layer.id}`);
  ids.add(layer.id);

  if (layer.source && !style.sources[layer.source]) {
    problems.push(`${layer.id}: references missing source "${layer.source}"`);
  }
  if (layer.source && style.sources[layer.source]?.type === 'vector' && !layer['source-layer']
      && layer.type !== 'background') {
    problems.push(`${layer.id}: vector source needs a source-layer`);
  }
  for (const group of ['paint', 'layout']) {
    for (const [prop, value] of Object.entries(layer[group] || {})) {
      checkProperty(value, `${layer.id}.${group}.${prop}`);
    }
  }
  if (layer.filter) findZoom(layer.filter, 'filter', `${layer.id}.filter`);
}

if (problems.length) {
  console.error(`style INVALID — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`style OK — ${style.layers.length} layers, ${Object.keys(style.sources).length} sources`);
```

- [ ] **Step 2: Write the trimmed style**

```javascript
// blind-map/style.js
//
// The blind-map style — the map-legibility test harness's evidence surface.
//
// Forked from legacy/atlas/style.js and trimmed to exactly what
// design-intent.md's "prove the map reads" gate needs: road class (colour
// AND width, never hue alone), terrain, water, land cover. Every label layer
// is gone deliberately — this map is read by geometry and class, not by
// names, because the game it proves out never shows names at this stage
// either. Deleted relative to the fork: road-labels, place-labels,
// city-labels, city-dots, boundary, run-ends, run-labels,
// route-halo/alt/best — all atlas-specific or label-bearing.
//
// Kept as data in its own file so it can be validated in node without a
// browser — see check-style.mjs.

(function (root) {
  const OFM = 'https://tiles.openfreemap.org';

  const CLASS_COLOUR = [
    'match', ['get', 'class'],
    'motorway', '#e8503a',
    'trunk', '#ef8a3c',
    'primary', '#f0b357',
    'secondary', '#ddc79a',
    'tertiary', '#c4bda6',
    '#b9b39f',
  ];

  const CLASS_WIDTH = [
    'match', ['get', 'class'],
    'motorway', 1.0, 'trunk', 0.82, 'primary', 0.66,
    'secondary', 0.50, 'tertiary', 0.38, 'minor', 0.28,
    0.24,
  ];

  const SURFACE_ADJ = [
    'case',
    ['==', ['get', 'surface'], 'unpaved'], 0.7,
    ['==', ['get', 'expressway'], 1], 1.15,
    1.0,
  ];
  const ROAD_WIDTH = ['*', CLASS_WIDTH, SURFACE_ADJ];

  function zoomWidth(stops, mult = 1, add = 0) {
    const expr = ['interpolate', ['exponential', 1.4], ['zoom']];
    for (let i = 0; i < stops.length; i += 2) {
      let value = mult === 1 ? stops[i + 1] : ['*', stops[i + 1], mult];
      if (add) value = ['+', value, add];
      expr.push(stops[i], value);
    }
    return expr;
  }

  const style = {
    version: 8,
    sources: {
      omt: { type: 'vector', url: `${OFM}/planet` },
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium', tileSize: 256, maxzoom: 12,
        attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
      },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': '#5a714d' } },

      { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        paint: {
          'fill-color': ['match', ['get', 'class'],
            'wood', 'rgba(27,71,44,.60)', 'forest', 'rgba(27,71,44,.60)',
            'grass', 'rgba(104,124,86,.32)', 'farmland', 'rgba(146,142,96,.20)',
            'rgba(120,132,98,.16)'],
        } },

      { id: 'hillshade', type: 'hillshade', source: 'dem',
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#0d1a12',
          'hillshade-highlight-color': '#cfe0bb', 'hillshade-accent-color': '#25301f' } },

      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
        paint: { 'fill-color': '#16394f' } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
        paint: { 'line-color': '#20648f', 'line-width': zoomWidth([4, 0.4, 10, 1.8]) } },

      { id: 'roads-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['!=', ['get', 'class'], 'service'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#161a21', 'line-opacity': 0.85,
          'line-width': zoomWidth([4, 0.9, 8, 2.8, 13, 10], ROAD_WIDTH, 1.4) } },
      { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['!=', ['get', 'class'], 'service'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CLASS_COLOUR,
          'line-width': zoomWidth([4, 0.9, 8, 2.8, 13, 10], ROAD_WIDTH) } },
    ],
  };

  root.BLIND_MAP_STYLE = style;
  if (typeof module !== 'undefined' && module.exports) module.exports = { style };
}(typeof window !== 'undefined' ? window : globalThis));
```

- [ ] **Step 3: Run the validator**

Run: `node blind-map/check-style.mjs`
Expected: `style OK — 7 layers, 2 sources`, exit code 0

- [ ] **Step 4: Add the npm script**

Add to `package.json`'s `"scripts"` object:

```json
"blind-map:check": "node blind-map/check-style.mjs",
```

- [ ] **Step 5: Commit**

```bash
git add blind-map/style.js blind-map/check-style.mjs package.json
git commit -m "feat(blind-map): label-stripped evidence-surface style"
```

---

### Task 5: The harness page

**Files:**
- Create: `blind-map/vendor/maplibre-gl.js` (copied)
- Create: `blind-map/vendor/maplibre-gl.css` (copied)
- Create: `blind-map/index.html`
- Create: `blind-map/blind-gl.js`
- Create: `scripts/serve-blind-map.mjs`
- Modify: `package.json` (add `blind-map` script)

**Interfaces:**
- Consumes: `metersToPixels` (Task 1), `blind-map/candidates.json` (Task 3), `window.BLIND_MAP_STYLE` (Task 4).
- Produces: a running server at `http://localhost:8141/` (port overridable via `PORT` env var, same pattern as the retired `legacy/scripts/serve-atlas.mjs`). Consumed by Task 6's test-protocol run and by the human tester.

- [ ] **Step 1: Copy the vendored MapLibre build**

Copied, not imported from `legacy/` — nothing in new code depends on retired
code, matching the discipline the retirement itself established.

```bash
mkdir -p blind-map/vendor
cp legacy/atlas/vendor/maplibre-gl.js blind-map/vendor/maplibre-gl.js
cp legacy/atlas/vendor/maplibre-gl.css blind-map/vendor/maplibre-gl.css
```

- [ ] **Step 2: Write the page shell**

```html
<!-- blind-map/index.html -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>blind map — evidence surface test</title>
<link rel="stylesheet" href="vendor/maplibre-gl.css">
<style>
  html, body { margin: 0; height: 100%; background: #0b0f17; font-family: system-ui, sans-serif; }
  #map { position: absolute; inset: 0; }
  #fog {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(circle at 50% 50%,
      transparent 0, transparent var(--radius-px, 120px),
      rgba(5,7,10,0.97) calc(var(--radius-px, 120px) + 1px), rgba(5,7,10,0.97) 100%);
  }
  #hud {
    position: absolute; top: 12px; left: 12px; z-index: 2;
    background: rgba(8,12,18,.85); color: #f4efe2; padding: 8px 12px;
    border-radius: 6px; font-size: 13px;
  }
  #hud button { margin-top: 6px; font-size: 13px; }
  #err { display: none; position: absolute; top: 0; left: 0; right: 0; z-index: 3;
    background: #b3261e; color: #fff; padding: 8px; font-family: monospace; }
</style>
</head>
<body>
<div id="map"></div>
<div id="fog"></div>
<div id="hud">
  <div>candidate <span id="idx">1</span> / <span id="total">-</span></div>
  <button id="next">next</button>
</div>
<div id="err"></div>
<script src="vendor/maplibre-gl.js"></script>
<script src="style.js"></script>
<script type="module" src="blind-gl.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write the page controller**

```javascript
// blind-map/blind-gl.js
//
// The map-legibility test harness. One real junction at a time, at a fixed
// zoom, with everything outside a ~300m radius hidden — design-intent.md's
// fog-of-war radius, "The loop". No pan, no zoom: the fiction is that you
// can only ever see this far, so letting a tester zoom out to cheat would
// invalidate the test this harness exists to run.

import { metersToPixels } from './fog-radius.mjs';

const FOG_RADIUS_METERS = 300;
const FIXED_ZOOM = 16;

const fail = (msg) => {
  const el = document.getElementById('err');
  el.style.display = 'block';
  el.textContent = msg;
  console.error('[blind-map]', msg);
};

const idxEl = document.getElementById('idx');
const totalEl = document.getElementById('total');
const fogEl = document.getElementById('fog');
const nextBtn = document.getElementById('next');

async function main() {
  if (!window.BLIND_MAP_STYLE) { fail('style.js did not load — the map has no style to render.'); return; }
  const res = await fetch('candidates.json');
  if (!res.ok) { fail(`could not load candidates.json (${res.status})`); return; }
  const candidates = await res.json();
  if (!candidates.length) { fail('candidates.json is empty'); return; }

  let i = 0;
  totalEl.textContent = String(candidates.length);

  const map = new maplibregl.Map({
    container: 'map',
    style: window.BLIND_MAP_STYLE,
    center: [candidates[0].lon, candidates[0].lat],
    zoom: FIXED_ZOOM,
    interactive: false,
    attributionControl: false,
  });

  map.on('error', (e) => {
    const msg = e && e.error ? e.error.message : String(e);
    if (/style|expression|layer|source/i.test(msg)) fail(`Style error: ${msg}`);
    else console.warn('[blind-map]', msg);
  });

  function showCandidate(index) {
    const c = candidates[index];
    map.jumpTo({ center: [c.lon, c.lat], zoom: FIXED_ZOOM });
    const px = metersToPixels(FOG_RADIUS_METERS, c.lat, FIXED_ZOOM);
    fogEl.style.setProperty('--radius-px', `${px}px`);
    idxEl.textContent = String(index + 1);
  }

  map.on('load', () => showCandidate(i));
  nextBtn.addEventListener('click', () => {
    i = (i + 1) % candidates.length;
    showCandidate(i);
  });
}

main();
```

- [ ] **Step 4: Write the static server**

```javascript
// scripts/serve-blind-map.mjs
//
// Minimal static server for blind-map/ — design-intent.md's "prove the map
// reads" test harness. No server-side logic: every candidate junction is
// precomputed into candidates.json by scripts/build-blind-map-candidates.mjs,
// so this only ever serves files.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../blind-map/', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8141);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = join(ROOT, normalize(path === '/' ? '/index.html' : path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`  blind-map at http://localhost:${PORT}/\n`));
```

- [ ] **Step 5: Add the npm script**

Add to `package.json`'s `"scripts"` object:

```json
"blind-map": "node scripts/serve-blind-map.mjs",
```

- [ ] **Step 6: Verify manually**

Run: `npm run blind-map`

Then, with the server running:
1. Open `http://localhost:8141/` in a browser.
2. Confirm no message appears in the red `#err` banner, and the browser
   console has no errors.
3. Confirm a circular region of the map is visible, centered on screen, with
   everything outside it dark. Confirm you can see real road lines (colour
   and width varying) and terrain shading inside the circle.
4. Confirm the HUD reads "candidate 1 / 8".
5. Click "next" three times. Confirm the visible terrain/roads change each
   time (a different real place), the fog radius stays the same size, and
   the HUD count advances (2, 3, 4).
6. Stop the server (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add blind-map/vendor blind-map/index.html blind-map/blind-gl.js scripts/serve-blind-map.mjs package.json
git commit -m "feat(blind-map): the harness page and static server"
```

---

### Task 6: Test protocol and final verification

**Files:**
- Create: `blind-map/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: nothing further downstream — this is the plan's terminal deliverable.

- [ ] **Step 1: Write the test protocol**

```markdown
# blind-map: the map-legibility test harness

Proves (or disproves) `docs/superpowers/specs/2026-08-30-design-intent.md`'s
Phase 2 gate: *"at a junction, can a person identify the branches and form a
hypothesis about which leads toward the objective, and why?"*

## What this tests, and what it deliberately does not

This harness shows real branch geometry and road class (colour and width,
never hue alone) inside a fixed ~300m radius, at a fixed zoom, with no pan
and no zoom. It does **not** yet include signs, sun-shadow direction, or an
actual objective — those are later build-sequence phases. So the honest
version of the test this harness supports is narrower than the full fiction:

> For each candidate junction: how many branches can you see? Can you rank
> them by apparent significance (which looks like the road that goes
> somewhere, which looks minor)? Does the terrain/land-use around the
> junction (forest, farmland, water) read clearly?

If testers can't do that reliably, nothing downstream — signs, the
junction-decision loop, the whole game — is worth building on top of this
map yet.

## Running it

```sh
npm run blind-map:candidates   # regenerate candidates.json from data/road-graph/ (optional — already committed)
npm run blind-map:check        # validate style.js
npm run blind-map              # serve at http://localhost:8141/
```

## Recording results

Not automated — sit with a tester, show each candidate, ask the questions
above, write down what they say. There's no scoring here; the outcome is a
go/no-go on the map itself, made by a human, the same way design-intent.md's
build sequence requires before anything downstream gets planned.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS, all tests including `fog-radius.test.mjs`, `candidates.test.mjs`, and `blind-map-candidates-output.test.mjs`

- [ ] **Step 3: Run the style validator one more time**

Run: `npm run blind-map:check`
Expected: `style OK — 7 layers, 2 sources`, exit code 0

- [ ] **Step 4: Commit**

```bash
git add blind-map/README.md
git commit -m "docs(blind-map): the map-legibility test protocol"
```

---

## After this plan

This plan's deliverable is a go/no-go decision made by a human, not by code.
Once someone has actually run the test in `blind-map/README.md` against real
testers: if the map reads, the next plan is Phase 3 of the build
sequence — the junction-decision loop, minimal, on top of `core-loop/`. If it
doesn't, the fixes (radius size, style contrast, which layers are shown) get
made here, in `blind-map/`, before anything downstream is planned.
