# Canvas Evidence Surface — Phase 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canvas map engine render each road's real pace tiers along its
length, correctly ordered, so the player's only evidence signal actually works.

**Architecture:** The SVG engine already solves this with `roadRuns`
(`web/engine.js:78`), which splits an edge into runs of a single pace tier. That
splitting logic gets extracted into a renderer-agnostic `splitPaceRuns`, so there
is exactly one definition of it; `roadRuns` becomes a thin SVG wrapper and a new
pure module `web/map/road-tiers.js` gives the canvas the same runs as point
arrays. The canvas layer then swaps its per-edge bucketing for per-run bucketing
and stops inverting the tier order.

**Tech Stack:** Vanilla ES modules, HTML canvas 2D, `node:test` + `node:assert/strict`.
No dependencies are added.

**Spec:** `docs/superpowers/specs/2026-08-20-design-intent.md`

## Global Constraints

- **Tier ordering is fixed by the data pipeline.** `scripts/05-bundle.mjs:44`:
  `tierOf = (kmh) => (kmh >= FAST_KMH ? 2 : kmh >= ORDINARY_KMH ? 1 : 0)`.
  **Tier 2 is the fastest stretch, tier 0 the slowest.** Never invert this.
- **Fastest draws heaviest.** Per `docs/CARTOGRAPHY.md`, "Load-bearing": the drawn
  weight is how the player guesses how fast a road runs. Tier 2 → widest, tier 0 → thinnest.
- **Never hue alone.** Width must carry the ordering alongside colour.
- **Do not change any line widths in this plan.** The canvas ratio is currently
  3.2 : 1.4 (about 2.3:1) against the SVG's 2.8:1. Per `docs/CARTOGRAPHY.md` a
  width-ratio change is a *difficulty* change requiring `npm run balance`, and it
  is deliberately out of scope here. This plan fixes *which* road gets *which*
  existing width, nothing else.
- **`npm test` must pass before every commit.**
- Tests are ESM `.mjs` under `tests/`, run by `node --test 'tests/**/*.test.mjs'`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `web/engine.js` (modify) | Gains `splitPaceRuns(pts, pace)` — the single definition of run-splitting. `roadRuns` refactored to wrap it. |
| `web/map/road-tiers.js` (create) | Pure, canvas-facing: turns a graph's adjacency into three tier-bucketed lists of point arrays. No canvas, no DOM — trivially testable. |
| `web/map/cartography-layer.js` (modify) | Calls `bucketRoadRuns` instead of bucketing whole edges by their first segment. |
| `tests/pace-runs.test.mjs` (create) | Covers `splitPaceRuns` and that `roadRuns` still behaves. |
| `tests/road-tiers.test.mjs` (create) | Covers `bucketRoadRuns`: tier→bucket mapping (the anti-inversion guard), edge de-duplication, and a real-data collapse guard. |
| `docs/CARTOGRAPHY.md` (modify) | Records the canvas pace tell as a real contract now that it works. |

---

## Task 1: Extract `splitPaceRuns`

**Files:**
- Modify: `web/engine.js:73-93` (the `roadRuns` block)
- Test: `tests/pace-runs.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `splitPaceRuns(pts, pace) -> Array<{tier: number, pts: Array<[number, number]>}>`
  exported from `web/engine.js`. Consecutive runs overlap by one point so a drawn
  line stays unbroken. Returns `[]` when `pts` has fewer than 2 points.
  `roadRuns(edge, from, to) -> Array<{tier: number, d: string}>` keeps its existing signature and behaviour.

- [ ] **Step 1: Write the failing test**

Create `tests/pace-runs.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --test-name-pattern="single-tier road"`
Expected: FAIL — `splitPaceRuns` is not exported from `web/engine.js`.

- [ ] **Step 3: Add `splitPaceRuns` and refactor `roadRuns` onto it**

In `web/engine.js`, replace the whole `roadRuns` block (the doc comment opening at line 73
through the closing brace at line 93) with:

```js
/**
 * A polyline split into runs of a single pace tier, so a road can be drawn the
 * way an atlas draws it: the motorway stretches heavy, the slow ones hairline.
 * Runs overlap by a point so the drawn line stays unbroken.
 *
 * Renderer-agnostic on purpose — `roadRuns` wraps this for the SVG game and
 * `web/map/road-tiers.js` uses it directly for the canvas. One definition, so
 * the two renderers cannot drift apart on the game's load-bearing signal.
 */
export function splitPaceRuns(pts, pace) {
  if (!pts || !pace || pts.length < 2) return [];
  const runs = [];
  let start = 0;
  for (let i = 1; i <= pts.length; i++) {
    if (i === pts.length || pace[i] !== pace[start]) {
      const slice = pts.slice(start, Math.min(i + 1, pts.length));
      if (slice.length > 1) runs.push({ tier: pace[start], pts: slice });
      start = i;
    }
  }
  return runs;
}

/**
 * The road broken into runs of one pace, as SVG path strings.
 */
export function roadRuns(edge, from, to) {
  const o = oriented(edge, from, to);
  if (!o) return [];
  return splitPaceRuns(o.pts, o.pace).map(({ tier, pts }) => (
    { tier, d: `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}` }
  ));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, including the pre-existing suites (`roadRuns` is consumed by the
shipped game, so a regression there would surface here).

- [ ] **Step 5: Commit**

```bash
git add web/engine.js tests/pace-runs.test.mjs
git commit -m "refactor(engine): extract splitPaceRuns so both renderers share one definition"
```

---

## Task 2: Bucket road runs by tier, correctly

**Files:**
- Create: `web/map/road-tiers.js`
- Test: `tests/road-tiers.test.mjs` (create)

**Interfaces:**
- Consumes: `splitPaceRuns(pts, pace)` from Task 1.
- Produces, from `web/map/road-tiers.js`:
  - `TIER_MOTORWAY = 2`, `TIER_TRUNK = 1`, `TIER_PRIMARY = 0`
  - `bucketRoadRuns(adj) -> {motorways: Array<Array<[number, number]>>, trunks: ..., primaries: ...}`
    where each array element is a point array ready for
    `CartographyLayer.drawShapeBatch(ctx, list)`.

- [ ] **Step 1: Write the failing test**

Create `tests/road-tiers.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --test-name-pattern="never inverted"`
Expected: FAIL — `web/map/road-tiers.js` does not exist.

- [ ] **Step 3: Create `web/map/road-tiers.js`**

```js
/**
 * Which drawing bucket each stretch of road belongs in.
 *
 * The pace tier IS the player's evidence (docs/CARTOGRAPHY.md, "Load-bearing"):
 * a road's drawn weight is how they guess how fast it runs. `scripts/05-bundle.mjs`
 * is the authority on the ordering — a stretch is tier 2 at or above FAST_KMH —
 * so tier 2 is the FASTEST and must draw heaviest. Inverting this deletes the
 * game's core signal.
 *
 * A road is split along its length rather than classified whole: a single
 * city-to-city road is routinely motorway in the middle and slow at both ends,
 * and drawing it as one class throws that away.
 */
import { splitPaceRuns } from '../engine.js';

export const TIER_MOTORWAY = 2;
export const TIER_TRUNK = 1;
export const TIER_PRIMARY = 0;

/**
 * Every road in the graph, split into single-pace runs and bucketed by tier.
 *
 * `buildGraph` pushes the same shape into both endpoints' adjacency lists, so
 * walking `adj` naively draws every road twice; `edge.to < i` keeps one copy.
 *
 * @param {Array<Array<{to: number, shape: Array<[number, number]>, pace: number[]}>>} adj
 * @returns {{motorways: Array<Array<[number, number]>>, trunks: Array<Array<[number, number]>>, primaries: Array<Array<[number, number]>>}}
 */
export function bucketRoadRuns(adj) {
  const motorways = [];
  const trunks = [];
  const primaries = [];
  if (!adj) return { motorways, trunks, primaries };

  for (let i = 0; i < adj.length; i++) {
    for (const edge of adj[i]) {
      if (edge.to < i) continue;
      if (!edge.shape || edge.shape.length < 2) continue;
      for (const run of splitPaceRuns(edge.shape, edge.pace)) {
        if (run.tier === TIER_MOTORWAY) motorways.push(run.pts);
        else if (run.tier === TIER_TRUNK) trunks.push(run.pts);
        else primaries.push(run.pts);
      }
    }
  }
  return { motorways, trunks, primaries };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS. The real-data test is the meaningful one — it fails if the tell
ever collapses into a single bucket again.

- [ ] **Step 5: Commit**

```bash
git add web/map/road-tiers.js tests/road-tiers.test.mjs
git commit -m "feat(map): bucket road runs by real pace tier, fastest drawn heaviest"
```

---

## Task 3: Wire the canvas to the real tiers

**Files:**
- Modify: `web/map/cartography-layer.js:166-178` (the bucketing block inside the road section)
- Modify: `docs/CARTOGRAPHY.md:103-107` (inside the "Not shipped" section)

**Interfaces:**
- Consumes: `bucketRoadRuns(adj)` from Task 2.
- Produces: no new exports. `CartographyLayer.drawShapeBatch` is unchanged — it
  already takes a list of point arrays, which is exactly what the buckets hold.

- [ ] **Step 1: Add the import**

At the top of `web/map/cartography-layer.js`, directly above the
`STRATEGIC_WAYPOINTS` constant, add:

```js
import { bucketRoadRuns } from './road-tiers.js';
```

- [ ] **Step 2: Replace the per-edge bucketing with per-run bucketing**

In `web/map/cartography-layer.js`, find this block (it begins just after the
`ctx.lineJoin = 'round';` line in section 4, "Road Networks"):

```js
      const motorways = [];
      const trunks = [];
      const primaries = [];

      for (const cityEdges of g.adj) {
        for (const edge of cityEdges) {
          if (!edge.shape || edge.shape.length < 2) continue;
          const pace = edge.pace[0] ?? 1;
          if (pace === 0) motorways.push(edge.shape);
          else if (pace === 1) trunks.push(edge.shape);
          else primaries.push(edge.shape);
        }
      }
```

Replace it with:

```js
      // Split along each road's length: a city-to-city road is routinely
      // motorway in the middle and slow at both ends, and the difference is the
      // whole tell. Tier 2 is the fastest and draws heaviest — see road-tiers.js.
      const { motorways, trunks, primaries } = bucketRoadRuns(g.adj);
```

Change nothing else in the section. The three width variables, the three drawing
passes and their zoom gates all stay exactly as they are — they were always
correct, they were being handed the wrong roads.

- [ ] **Step 3: Verify the whole suite still passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Look at the map**

Run: `npm run serve`, open the map studio at `/map-studio/`, and check all three:

1. **Zoom to a country.** Roads visibly change weight *along their length* —
   heavy through the fast middle, hairline into the towns. Before this change
   every road was one uniform weight.
2. **Zoom out past 900 km.** The motorway network is what survives. Before this
   change the surviving network was the *slowest* roads and the motorways
   vanished, which is precisely the view a corridor decision gets made in.
3. **Check the frame rate** in the studio's FPS counter at continental zoom. The
   split produces roughly 12,400 runs from 2,160 roads, but the total point count
   is unchanged and it still batches into the same three strokes per pass, so this
   should not move. If FPS drops noticeably, stop and report it rather than
   working around it.

- [ ] **Step 5: Record the contract in the cartography bible**

In `docs/CARTOGRAPHY.md`, in the `## Not shipped` section, replace this paragraph:

```markdown
**Would be load-bearing:** `roadMotorway`, `roadTrunk`, `roadPrimary`,
`roadSecondary`, `roadWidthMotorway`, `roadWidthTrunk`, `roadWidthPrimary`
(pace tier, colour and width together — currently 3.2 : 1.4, about 2.3:1);
`cityNode`, `cityNodeActive`, `cityNodeBorder` (scenery versus actionable);
`routeLine`, `routeLineGlow`.
```

with:

```markdown
**Would be load-bearing:** `roadMotorway`, `roadTrunk`, `roadPrimary`,
`roadSecondary`, `roadWidthMotorway`, `roadWidthTrunk`, `roadWidthPrimary`
(pace tier, colour and width together — currently 3.2 : 1.4, about 2.3:1);
`cityNode`, `cityNodeActive`, `cityNodeBorder` (scenery versus actionable);
`routeLine`, `routeLineGlow`.

**The canvas pace tell.** `web/map/road-tiers.js` splits every road into runs of
a single pace tier and buckets them, the same way the shipped SVG engine does via
`roadRuns`. Both renderers share one definition — `splitPaceRuns` in
`web/engine.js` — so they cannot drift apart on the signal the game is built on.

**Tier 2 is the fastest stretch and draws heaviest. Tier 0 is the slowest and
draws thinnest.** `scripts/05-bundle.mjs:44` is the authority. The canvas
previously inverted this *and* classified each road by its first segment alone —
the slow exit from a city — which put 99.6% of the network into one bucket and
deleted the tell entirely. `tests/road-tiers.test.mjs` guards both failures.

The canvas ratio (about 2.3:1) is still narrower than the shipped SVG's 2.8:1.
Closing that gap is a difficulty change and needs `npm run balance`, so it is
deliberately left open rather than adjusted in passing.
```

- [ ] **Step 6: Confirm the doc test still passes**

Run: `npm test -- --test-name-pattern="cartography"`
Expected: PASS. `tests/cartography-doc.test.mjs` fails if a styling token exists
in code but is not classified in this doc; no tokens were added, so this should
stay green. If it fails, the message names the unclassified token — add it to the
correct list rather than deleting the assertion.

- [ ] **Step 7: Commit**

```bash
git add web/map/cartography-layer.js docs/CARTOGRAPHY.md
git commit -m "fix(map): render real pace tiers along each road instead of one inverted class"
```

---

## Done when

- `npm test` is green.
- Roads visibly change weight along their length in the map studio.
- The motorway network is what remains visible at continental zoom.
- `docs/CARTOGRAPHY.md` records the tier ordering, so the inversion cannot
  silently return.

## Explicitly not in this plan

Each is separate work, and two of them are open design questions in the spec
rather than implementation:

- **Line-width ratio tuning** (2.3:1 → 2.8:1). A difficulty change; needs `npm run balance`.
- **Alternative-corridor rendering.** Brief requirement 2, and an open question —
  which visual channel carries it without burying road character.
- **Risk-exposure rendering.** Brief requirement 5, and an open question.
- **The plan-time reading test.** The gate that follows this work: can a player,
  from the map alone, identify the distinct corridors and say which is faster and
  why? It cannot be run until roads render truthfully, which is what this plan delivers.
