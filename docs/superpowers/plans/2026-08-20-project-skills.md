# Project Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build four tools that make silent data and difficulty regressions in the Route pipeline loud and mechanical.

**Architecture:** Each tool splits into a pure, dependency-free library in `scripts/lib/` (tested with synthetic fixtures) and a thin CLI that wires it to real files and sets an exit code. Tests use Node's built-in `node --test` runner — no new dependencies. The cartography bible is a document whose accuracy is enforced by a test.

**Tech Stack:** Node v25.8.1, ES modules (`"type": "module"`), `node:test` + `node:assert/strict`. No new dependencies.

## Global Constraints

- **No new npm dependencies.** `devDependencies` stays `d3-delaunay` + `mapshaper`.
- **ES modules only.** Every file uses `import`, never `require`.
- **Libraries in `scripts/lib/` stay dependency-free and side-effect-free** — the convention stated at `scripts/lib/graph.mjs:1-2`. No file I/O, no `console.log`, no `process.exit` in a lib. All three live in the CLI.
- **Thresholds are read from data, never hardcoded.** `data/puzzles.json`'s `criteria` block is the source of truth for balance thresholds; `web/perf-budget.json` for payload budgets. A missing block is a hard error, never a silent default.
- **Exit codes:** `0` = pass (warnings allowed), `1` = a hard check failed, `2` = the tool could not run.
- **Path references are `file:line` against the tree as of 2026-08-20.**

## Corrections to the spec

Found while planning. The plan is authoritative where it disagrees with
`docs/superpowers/specs/2026-08-20-project-skills-design.md`.

1. **The live sweep is `play/calibrate-hos.mjs`, not `play/calibrate.mjs`.** The
   shipped set has driving-hours on (`data/puzzles.json` carries
   `hos: {continuousLimitMin: 270, breakMin: 45}`), so `calibrate.mjs` measures
   a game that no longer exists.
2. **`balance-check` needs two modes.** The HOS pool scan is a ~20-minute
   state-space search over ~350k pairs at 838 cities, but the check that
   matters — does the shortest road ever win? — is arithmetic over the shipped
   set and takes milliseconds. Default is fast; the cliff sweep is `--sweep`
   and reuses the cache at `data/.calibrate-hos-cache.json`.
3. **The street manifest is mismapped, not stale.** 477 of 479 entries in
   `web/streets/manifest.json` disagree with `data/graph.json`.
   `web/app.js:286` takes position from the current graph while
   `web/app.js:291` takes geometry from the manifest, so the shipped game draws
   the wrong city's streets. The check is geonameid agreement, not file count.
4. **`web/map/` is not the shipped game, so the bible must target `app.css`.**
   `web/index.html:174` loads only `app.js`, which imports only `./engine.js`.
   `web/map/map-engine.js` is imported solely by `web/map-studio/studio.js`, and
   `web/map/tile-layer.js` by nothing. `docs/MAP-SPEC.md:3` confirms it: "Not
   shipped. This is the spec for the active direction." The shipped game is SVG
   styled by `web/app.css`, and the pace tell lives at `web/app.css:228-235`.
   The bible covers the shipped tokens as the live contract and the
   `theme-config.js` presets as the direction being built toward.
5. **Every CLI's fatal reads exit 2, not 1.** Found during Task 3's review: the
   CLI code as originally drafted never called `process.exit(2)` anywhere,
   despite the Global Constraints requiring it — a missing or corrupt input
   file crashed with an uncaught exception, which Node exits with code 1,
   indistinguishable from a genuine check failure. Fixed in all three CLIs by
   wrapping only the reads each tool cannot function without in try/catch,
   printing a clear stderr message, and exiting 2 — `web/perf-budget.json` and
   `web/data.json` in `perf-profile.mjs`; `data/graph.json` and
   `data/puzzles.json` in `data-doctor.mjs`; `data/puzzles.json`,
   `data/graph.json`, and the `readCriteria` failure inside `checkShippedSet`
   in `balance-check.mjs`. Reads that are legitimately optional — the street
   manifest in both `perf-profile.mjs` and `data-doctor.mjs`, the terrain-tiles
   manifest, the `--sweep` cache — stay lenient (skip-and-continue, or a clean
   early exit at 0/1), since their absence is a normal build-order state, not
   a broken tool.

## File Structure

**Create:**

| file | responsibility |
| --- | --- |
| `tests/cartography-doc.test.mjs` | asserts every live design token is classified in the bible |
| `tests/asset-scan.test.mjs` | reachability + classification unit tests |
| `tests/data-doctor.test.mjs` | DAG staleness + manifest agreement unit tests |
| `tests/balance.test.mjs` | criteria evaluation + cliff detection unit tests |
| `scripts/lib/asset-scan.mjs` | pure: reachability from entry points, asset classification |
| `scripts/lib/dag.mjs` | pure: pipeline DAG, staleness rules, manifest agreement |
| `scripts/lib/balance.mjs` | pure: criteria evaluation, sweep rows, cliff detection |
| `scripts/perf-profile.mjs` | CLI: payload audit |
| `scripts/data-doctor.mjs` | CLI: pipeline consistency check |
| `play/balance-check.mjs` | CLI: difficulty check |
| `web/perf-budget.json` | committed budgets, entry points, manifest declarations |
| `docs/CARTOGRAPHY.md` | load-bearing vs scenery contract |
| `.claude/skills/{perf-profile,rebuild-data,balance-check}/SKILL.md` | thin skill wrappers |

**Modify:** `package.json` — add `test`, `perf`, `doctor`, `balance`; fix the `data:map` ordering bug.

---

### Task 1: Test harness and the cartography bible

**Files:**
- Modify: `package.json` (add `test` script)
- Create: `tests/cartography-doc.test.mjs`
- Create: `docs/CARTOGRAPHY.md`

**Interfaces:**
- Consumes: `web/app.css` (shipped tokens), `THEME_PRESETS` from `web/map/theme-config.js:6` (unshipped tokens)
- Produces: `docs/CARTOGRAPHY.md` with exactly these H2 headings, which the test depends on: `## Load-bearing`, `## Scenery`, `## Not shipped`.

The bible's failure mode is going stale — a token added to code and never
classified. The test closes it.

- [ ] **Step 1: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "node --test tests/"
```

- [ ] **Step 2: Write the failing test**

Create `tests/cartography-doc.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_PRESETS } from '../web/map/theme-config.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const doc = read('../docs/CARTOGRAPHY.md');
const css = read('../web/app.css');

/** CSS custom properties declared in app.css's :root block. */
function shippedTokens() {
  const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  return [...new Set([...root.matchAll(/--([a-z][a-z0-9-]*)\s*:/g)].map((m) => `--${m[1]}`))].sort();
}

/** The pace-tier rules that encode how fast a road runs. */
function paceClasses() {
  return [...new Set([...css.matchAll(/\.(reach-line|leg)\.(pace-[0-2])/g)]
    .map((m) => `.${m[1]}.${m[2]}`))].sort();
}

/** Every styling key across every preset, minus the human-readable label. */
function themeTokens() {
  const keys = new Set();
  for (const preset of Object.values(THEME_PRESETS)) {
    for (const k of Object.keys(preset)) if (k !== 'name') keys.add(k);
  }
  return [...keys].sort();
}

/** Text under an H2 heading, up to the next H2 or end of file. */
function section(heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `CARTOGRAPHY.md is missing a "## ${heading}" section`);
  const rest = doc.slice(start + 3);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Tokens must be written in backticks in the document, and are matched with the
 * backticks included. Plain substring matching would be wrong: `--dim` is a
 * substring of `--dimmer`, `--road` of `--road-hot`, and `land` of `farmland`,
 * so a bare includes() reports tokens as classified when they are not.
 */
const names = (text, token) => text.includes(`\`${token}\``);

test('every shipped CSS custom property is classified', () => {
  const live = section('Load-bearing') + section('Scenery');
  const missing = shippedTokens().filter((t) => !names(live, t));
  assert.deepEqual(missing, [], `unclassified app.css tokens: ${missing.join(', ')}`);
});

test('every pace-tier class is named as load-bearing', () => {
  const loadBearing = section('Load-bearing');
  const missing = paceClasses().filter((c) => !names(loadBearing, c));
  assert.deepEqual(missing, [], `pace classes missing from Load-bearing: ${missing.join(', ')}`);
});

test('there is at least one pace class to protect', () => {
  assert.ok(paceClasses().length >= 3, 'expected .reach-line.pace-0/1/2 in app.css');
});

test('every theme-config token is classified under Not shipped', () => {
  const notShipped = section('Not shipped');
  const missing = themeTokens().filter((t) => !names(notShipped, t));
  assert.deepEqual(missing, [], `unclassified theme tokens: ${missing.join(', ')}`);
});

test('no shipped token is classified as both load-bearing and scenery', () => {
  const loadBearing = section('Load-bearing');
  const scenery = section('Scenery');
  const both = shippedTokens().filter((t) => names(loadBearing, t) && names(scenery, t));
  assert.deepEqual(both, [], `tokens in both sections: ${both.join(', ')}`);
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npm test`
Expected: FAIL — `ENOENT` on `docs/CARTOGRAPHY.md`.

- [ ] **Step 4: Write the bible**

Create `docs/CARTOGRAPHY.md`:

```markdown
# Cartography bible

Which parts of the map's look carry information the player acts on, and which
are scenery. The two have different change rules: scenery is a taste decision,
load-bearing styling is a difficulty decision, and `npm run balance` is the
arbiter of the second.

**The shipped game is SVG styled by `web/app.css`.** `web/index.html:174` loads
`app.js`, which imports only `engine.js`. The canvas engine under `web/map/` is
the next-gen direction (`docs/MAP-SPEC.md:3`: "Not shipped"), reachable only
from `web/map-studio/`. Both are covered below, separately, because they will
eventually swap places.

`tests/cartography-doc.test.mjs` fails if a token exists in code but is not
classified here.

## Load-bearing

Frozen without a balance argument. These are the player's evidence.

**The pace tell.** A candidate road's drawn weight is how the player guesses
how fast it runs — the README's second paragraph makes this the core of the
puzzle.

| rule | width | encodes |
| --- | --- | --- |
| `.reach-line.pace-2` | 3.4 | candidate road, fastest tier |
| `.reach-line.pace-1` | 2 | candidate road, middle tier |
| `.reach-line.pace-0` | 1.2 | candidate road, slowest tier |
| `.leg.pace-2` | 3.6 | committed leg, fastest tier |
| `.leg.pace-1` | 2.4 | committed leg, middle tier |
| `.leg.pace-0` | 1.5 | committed leg, slowest tier |

The ratio is the signal: 3.4 : 1.2, about 2.8:1, at `web/app.css:228-230`.
Compressing it toward 1:1 deletes the tell and makes the game a coin flip.
Widening it makes the game easier. Either is a difficulty change and needs
`npm run balance` before and after.

Opacity carries the same ordering (.95 / .74 / .56) and must not be inverted
against width — the two channels have to agree or the tell becomes ambiguous.

**Colours that mean something:**

| token | meaning |
| --- | --- |
| `--road` | a road you can take |
| `--road-hot` | the candidate under hover or focus (`.reach-line--hot`) |
| `--reachable` | a city that is a legal move (`.dot--reachable`) |
| `--speck` | a city that exists but is not a legal move (`.dot`) |
| `--accent` | where you are standing (`.dot--current`) |
| `--ink` | the target (`.dot--target`) |
| `--dim` | already visited (`.dot--visited`) |
| `--red` | the budget gauge's alarm state |
| `--amber` | the middle tier of the background road network |
| `--bg` | the halo stroke that separates a legal-move city from the map |

`--road` and `--red` must stay distinguishable — the comment at
`web/app.css:23` already flags that collision. `--road` and `--amber` must stay
distinguishable for the reason in the road-network note below.

`--accent` is defined as `var(--neutral)` (`web/app.css:31`), so changing the
scenery token `--neutral` silently changes what "where you are standing" looks
like. Retuning `--neutral` needs a look at `.dot--current`.

**Never hue alone.** Legal-move versus scenery city, and the three pace tiers,
must survive without colour vision — via width, radius, or stroke. `--bg` is
used as a halo stroke on `.dot--reachable` (`web/app.css:174`) and that
separation is part of the contract, which is why it is listed above rather than
as scenery.

**Background road network.** `.road-network--0/1/2` (`web/app.css:127-129`)
has nothing wired to it, but it is load-bearing in one respect: it must stay
visually separable from `.reach-line`, or the player cannot tell a road they
can take from one they cannot. It currently reuses `--road` and `--amber` at
lower widths and opacities. Open question: whether its three tiers encode pace,
in which case it is a second tell and belongs fully in this section.

## Scenery

Free to retune without a balance argument.

`--land`, `--land-edge`, `--water`, `--water-line`, `--urban`, `--dimmer`,
`--neutral`, `--panel`, `--mono`, `--sans`.

Also scenery: `.street--0/1/2` (the city street grid) and the
`.streets`/`.streets--visible` fade.

`--neutral` carries one caveat: `--accent` is defined from it, so it is scenery
with a load-bearing consumer. See the note in Load-bearing.

**One constraint.** `.reach-line.pace-0` is the lowest-contrast thing the
player has to read. It must keep a contrast ratio of at least 3:1 — the WCAG
floor for non-text graphical objects — against every scenery colour it can be
drawn over, at its shipped `.56` opacity. Verify by hand when changing a
scenery colour; automate only if it proves to bite.

## Not shipped

`web/map/theme-config.js` defines five presets for the canvas engine that
`web/map-studio/` drives. None of it reaches a player today. Recorded here so
the contract is ready when it ships.

**Would be load-bearing:** `roadMotorway`, `roadTrunk`, `roadPrimary`,
`roadSecondary`, `roadWidthMotorway`, `roadWidthTrunk`, `roadWidthPrimary`
(pace tier, colour and width together — currently 3.2 : 1.4, about 2.3:1);
`cityNode`, `cityNodeActive`, `cityNodeBorder` (scenery versus actionable);
`routeLine`, `routeLineGlow`.

**Would be scenery:** `bg`, `water`, `land`, `coastline`, `borderWidth`,
`forest`, `farmland`, `urbanDay`, `urbanNight`, `urbanGlow`, `terrainOpacity`,
`terrainBlend`, `roadCasing`, `roadDivider`, `hudGlass`, `hudText`.

## Settled, do not revisit

- Real cartographic detail over hillshade relief is a known-good style
  (OpenTopoMap), not a category being invented. See `docs/MAP-SPEC.md`.
- Terrain relief is built and correct. Do not touch it.
- Reveal-by-zoom — overview raster, detail tier, then fine tiles — is the
  loading pattern every new layer copies.

## Open questions

1. Whether `.road-network--0/1/2` encodes pace or road class. Changes which
   section it belongs in.
2. `theme-config.js` ships five presets and `satelliteTopo` is the constructor
   default (`web/map/theme-config.js:165`). Whether the other four are planned
   features, debug affordances, or dead code is not determinable from the file.
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, 5 tests.

If a token is reported unclassified, add it to the correct section. Do not
weaken the assertion. If a token's classification is genuinely unclear, put it
in `Scenery` and add it to Open questions — a wrong-but-recorded call beats an
untracked one.

- [ ] **Step 6: Commit**

```bash
git add package.json tests/cartography-doc.test.mjs docs/CARTOGRAPHY.md
git commit -m "docs: add cartography bible with a test that keeps it current"
```

---

### Task 2: Asset reachability library

**Files:**
- Create: `scripts/lib/asset-scan.mjs`
- Test: `tests/asset-scan.test.mjs`

**Interfaces:**
- Produces:
  - `referencesIn(text: string): Set<string>` — asset basenames mentioned in one source file. Matches basenames anywhere, so `` `../forest.webp?v=${v}` `` is found.
  - `classify({ assets, sources, entryPoints, manifests }): { eager, deferred, orphan }` where `assets: string[]` are web-relative paths, `sources: Map<string,string>` is path → contents, `entryPoints: string[]` seed the walk, and `manifests: Array<{file, provides}>` declare indirect references. Buckets are sorted `string[]`.

**Reachability, not mere mention.** The walk starts at the entry points and
follows references transitively: a file is eager only if the entry point can
actually reach it. This is what distinguishes `web/map/`'s modules — which
reference each other happily but are unreachable from `index.html` — from live
code. A "does any file mention it" check would wrongly pass them.

- [ ] **Step 1: Write the failing tests**

Create `tests/asset-scan.test.mjs`:

```js
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
```

- [ ] **Step 2: Run and verify it fails**

Run: `node --test tests/asset-scan.test.mjs`
Expected: FAIL — cannot find module `../scripts/lib/asset-scan.mjs`.

- [ ] **Step 3: Implement the library**

Create `scripts/lib/asset-scan.mjs`:

```js
// Pure asset-reachability analysis for the perf audit. No I/O — the caller
// reads files and hands in contents, same convention as scripts/lib/graph.mjs.

const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
const PATTERN = /[A-Za-z0-9_][A-Za-z0-9._/-]*\.(?:webp|json|png|css|js|html)/g;

/**
 * Asset basenames mentioned in one source file. Basename rather than full path,
 * because the client builds paths with relative prefixes and `?v=`
 * cache-busting template literals — see web/map/terrain-layer.js:50.
 */
export function referencesIn(text) {
  const found = new Set();
  for (const match of text.matchAll(PATTERN)) found.add(basename(match[0]));
  return found;
}

/**
 * Split assets into eager (transitively reachable from an entry point),
 * deferred (reached only through a reachable manifest) and orphan.
 *
 * Reachability rather than mention: web/map/'s modules reference each other but
 * nothing in the shipped game reaches them (web/index.html:174 loads only
 * app.js), and a mention-based check would wrongly call them live.
 *
 * Where two assets share a basename the walk reaches both. That is deliberate:
 * over-reporting an orphan is a worse failure than missing one.
 */
export function classify({ assets, sources, entryPoints, manifests }) {
  const byBasename = new Map();
  for (const a of assets) {
    const key = basename(a);
    if (!byBasename.has(key)) byBasename.set(key, []);
    byBasename.get(key).push(a);
  }

  const reached = new Set();
  const queue = entryPoints.filter((e) => assets.includes(e));
  queue.forEach((e) => reached.add(e));

  while (queue.length) {
    const current = queue.pop();
    const text = sources.get(current);
    if (text === undefined) continue; // a binary asset refers to nothing
    for (const ref of referencesIn(text)) {
      for (const target of byBasename.get(ref) ?? []) {
        if (reached.has(target)) continue;
        reached.add(target);
        queue.push(target);
      }
    }
  }

  const deferred = new Set();
  for (const m of manifests) {
    if (!reached.has(m.file)) continue;
    for (const p of m.provides) if (!reached.has(p)) deferred.add(p);
  }

  const sort = (xs) => [...xs].sort();
  return {
    eager: sort(reached),
    deferred: sort(deferred),
    orphan: assets.filter((a) => !reached.has(a) && !deferred.has(a)).sort(),
  };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `node --test tests/asset-scan.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/asset-scan.mjs tests/asset-scan.test.mjs
git commit -m "feat: add asset reachability analysis for the perf audit"
```

---

### Task 3: perf-profile CLI and budget file

**Files:**
- Create: `scripts/perf-profile.mjs`
- Create: `web/perf-budget.json`
- Modify: `package.json` (add `perf` script)

**Interfaces:**
- Consumes: `classify` from `scripts/lib/asset-scan.mjs`
- Produces: `npm run perf` — exit 1 on a busted budget or an unrecorded orphan.

Budgets are seeded from measurements taken 2026-08-20 with a little headroom,
so the tool passes today and catches *growth*. The eager total is already a
problem at 17.9 MB; that is reported in prose rather than encoded as a
permanently failing test nobody will read.

- [ ] **Step 1: Write the budget file**

Create `web/perf-budget.json`:

```json
{
  "comment": "Payload budgets in KB, seeded from measurement on 2026-08-20. Edit deliberately, in the same commit as the change that needs it. Never raise a budget just to get a green run.",
  "entryPoints": ["index.html"],
  "skipDirs": ["map-studio", "road-network-proto"],
  "budgets": {
    "eagerTotalKB": 18300,
    "deferredTotalKB": 31000,
    "streetTotalKB": 3400,
    "largestStreetFileKB": 30
  },
  "manifests": [
    { "file": "terrain-tiles.json", "key": "tiles", "pathField": "file" },
    { "file": "streets/manifest.json", "key": null, "pathField": null }
  ],
  "knownOrphans": []
}
```

`knownOrphans` starts empty deliberately — the current orphans should fail the
first run. Record one there only as a considered decision to keep shipping it,
with a reason.

- [ ] **Step 2: Write the CLI**

Create `scripts/perf-profile.mjs`:

```js
#!/usr/bin/env node
// Static payload audit. No browser, no new dependencies. Answers: what does a
// player download, what is dead weight, and has any of it grown past budget?

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { classify } from './lib/asset-scan.mjs';

const WEB = new URL('../web/', import.meta.url);
const SOURCE_EXT = new Set(['.js', '.html', '.css']);
const ASSET_EXT = new Set(['.webp', '.json', '.png', '.js', '.css', '.html']);

const config = JSON.parse(readFileSync(new URL('perf-budget.json', WEB), 'utf8'));
const skip = new Set(config.skipDirs);
const ext = (p) => p.slice(p.lastIndexOf('.'));

function walk(dir = WEB, prefix = '', out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue;
      walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, out);
    } else out.push(`${prefix}${entry.name}`);
  }
  return out;
}

const sources = new Map();
const assets = [];
for (const path of walk()) {
  if (path === 'perf-budget.json') continue;
  if (SOURCE_EXT.has(ext(path))) sources.set(path, readFileSync(new URL(path, WEB), 'utf8'));
  if (ASSET_EXT.has(ext(path))) assets.push(path);
}

// Resolve each declared manifest into the asset paths it provides.
const manifests = [];
for (const m of config.manifests) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(new URL(m.file, WEB), 'utf8')); } catch { continue; }
  const dir = m.file.slice(0, m.file.lastIndexOf('/') + 1);
  const provides = m.key
    ? (parsed[m.key] ?? []).map((t) => t[m.pathField])
    // streets/manifest.json is index -> geonameid; files sit beside it.
    : Object.values(parsed).map((gid) => `${dir}${gid}.json`);
  manifests.push({ file: m.file, provides: provides.filter((p) => assets.includes(p)) });
}

const { eager, deferred, orphan } = classify({
  assets, sources, entryPoints: config.entryPoints, manifests,
});

const sizeKB = (p) => statSync(new URL(p, WEB)).size / 1024;
const totalKB = (list) => list.reduce((t, p) => t + sizeKB(p), 0);
const kb = (n) => `${n.toFixed(0)} KB`.padStart(10);

let failed = false;
const fail = (msg) => { failed = true; console.log(`  FAIL  ${msg}`); };

const eagerKB = totalKB(eager);
console.log(`\n=== eager: reachable from ${config.entryPoints.join(', ')} ===`);
for (const p of [...eager].sort((a, b) => sizeKB(b) - sizeKB(a)).slice(0, 10)) {
  console.log(`${kb(sizeKB(p))}  ${p}`);
}
console.log(`${kb(eagerKB)}  TOTAL of ${eager.length} files (budget ${config.budgets.eagerTotalKB} KB)`);

const streets = deferred.filter((p) => p.startsWith('streets/'));
const deferredKB = totalKB(deferred);
console.log('\n=== deferred: requested on demand ===');
console.log(`${kb(deferredKB)}  ${deferred.length} files (budget ${config.budgets.deferredTotalKB} KB)`);
if (streets.length) {
  const largest = streets.reduce((a, b) => (sizeKB(a) > sizeKB(b) ? a : b));
  console.log(`${kb(totalKB(streets))}  ${streets.length} street files, largest ${largest}`);
}

console.log('\n=== orphaned: shipped, reachable from nothing ===');
const known = new Set(config.knownOrphans);
if (!orphan.length) console.log('  none');
for (const p of orphan) console.log(`${kb(sizeKB(p))}  ${p}${known.has(p) ? '  (known)' : ''}`);

console.log('\n=== draw-loop inputs ===');
const data = JSON.parse(readFileSync(new URL('data.json', WEB), 'utf8'));
console.log(`  cities ${data.cities.length}, edges ${data.edges.length}, `
  + `urbanAreas ${data.urbanAreas.length}, towns ${data.towns.length}, `
  + `rivers ${data.rivers.length}, lakes ${data.lakes.length}`);

console.log('\n=== budgets ===');
const check = (actual, budget, label) => {
  if (actual > budget) fail(`${label} ${actual.toFixed(0)} KB over budget ${budget} KB`);
};
check(eagerKB, config.budgets.eagerTotalKB, 'eager payload');
check(deferredKB, config.budgets.deferredTotalKB, 'deferred payload');
check(totalKB(streets), config.budgets.streetTotalKB, 'street data');
for (const p of streets) check(sizeKB(p), config.budgets.largestStreetFileKB, p);
for (const p of orphan) {
  if (!known.has(p)) fail(`${p} (${sizeKB(p).toFixed(0)} KB) is shipped but reachable from nothing`);
}
if (!failed) console.log('  all within budget');

process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"perf": "node scripts/perf-profile.mjs"
```

- [ ] **Step 4: Run it against real data**

Run: `npm run perf`

Expected: exit 1. Measured at plan time, the run should report:

- eager ≈ 17,946 KB across 17 files, led by `forest-detail.webp` (9,669 KB),
  `terrain-detail.webp` (3,088 KB), `data.json` (2,731 KB), `forest.webp`
  (1,698 KB), `terrain.webp` (594 KB)
- deferred ≈ 30,376 KB — terrain tiles ≈ 27,079 KB, streets ≈ 3,296 KB,
  largest street file 26 KB
- orphaned ≈ 1,554 KB — `cartography.json` (750 KB), `water-detail.webp`
  (612 KB), `water.webp` (183 KB), plus the whole unreachable `map/` subtree

The `map/` files are a true finding, not a bug in the classifier:
`web/index.html:174` loads only `app.js`, and `map/map-engine.js` is imported
only by `web/map-studio/studio.js`, which is skipped as a prototype. Report it;
do not add `map/` to `skipDirs` to quieten it.

If the numbers differ materially from the above, the tree has changed — say so
rather than adjusting budgets to fit.

- [ ] **Step 5: Commit**

```bash
git add scripts/perf-profile.mjs web/perf-budget.json package.json
git commit -m "feat: add static payload audit with committed budgets"
```

---

### Task 4: Pipeline DAG library

**Files:**
- Create: `scripts/lib/dag.mjs`
- Test: `tests/data-doctor.test.mjs`

**Interfaces:**
- Produces:
  - `PIPELINE: Array<{ script, inputs: string[], outputs: string[], needs: string[] }>` — repo-relative paths.
  - `stalenessCheck(mtimes: Map<string, number>): Array<{ output, input }>` — outputs older than an input. Missing files are skipped: absence is a different problem from staleness.
  - `manifestAgreement(manifest, cities): { checked, agree, disagree: Array<{index, manifestGid, graphGid}> }`
  - `puzzleIndexCheck(puzzles, cityCount): number[]` — out-of-range indices, deduplicated and sorted.

- [ ] **Step 1: Write the failing tests**

Create `tests/data-doctor.test.mjs`:

```js
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
```

- [ ] **Step 2: Run and verify it fails**

Run: `node --test tests/data-doctor.test.mjs`
Expected: FAIL — cannot find module `../scripts/lib/dag.mjs`.

- [ ] **Step 3: Implement the library**

Create `scripts/lib/dag.mjs`:

```js
// The build pipeline as data, plus the consistency rules that ride on it.
// Pure — no I/O, no logging. Derived from the actual readFileSync/writeFileSync
// sites in scripts/, not from the npm script names, which were wrong (see the
// 04-terrain note below).

export const PIPELINE = [
  { script: 'scripts/00-cities.mjs', inputs: ['data/raw/cities15000.txt'], outputs: ['data/cities.json'], needs: [] },
  { script: 'scripts/01-graph.mjs', inputs: ['data/cities.json'], outputs: ['data/graph.json'], needs: ['OSRM'] },
  { script: 'scripts/02-puzzles.mjs', inputs: ['data/graph.json'], outputs: ['data/puzzles.json'], needs: [] },
  { script: 'scripts/03-map.mjs', inputs: ['data/graph.json'], outputs: ['data/map.json'], needs: ['OSRM'] },
  { script: 'scripts/06-road-names.mjs', inputs: ['data/graph.json'], outputs: ['data/road-names.json'], needs: ['OSRM'] },
  { script: 'scripts/07-streets.mjs', inputs: ['data/graph.json'], outputs: ['web/streets/manifest.json'], needs: ['Overpass'] },
  {
    script: 'scripts/05-bundle.mjs',
    inputs: ['data/graph.json', 'data/map.json', 'data/puzzles.json', 'data/road-names.json'],
    outputs: ['web/data.json'],
    needs: [],
  },
  // Everything below consumes web/data.json, which is why 05-bundle must run
  // first. package.json's data:map had 04-terrain second and 05-bundle third,
  // so 04-terrain read the previous run's bundle.
  {
    script: 'scripts/04-terrain.py',
    inputs: ['data/map.json', 'web/data.json'],
    outputs: ['web/terrain.webp', 'web/terrain-detail.webp', 'web/terrain-tiles.json'],
    needs: [],
  },
  {
    script: 'scripts/10-water-raster.py',
    inputs: ['data/map.json', 'web/data.json'],
    outputs: ['web/water.webp', 'web/water-detail.webp'],
    needs: [],
  },
  {
    script: 'scripts/11-urban-satellite-raster.py',
    inputs: ['data/map.json', 'web/data.json'],
    outputs: ['web/urban-day.webp', 'web/urban-night.webp'],
    needs: [],
  },
  // Both write web/cartography.json in full and neither reads it back, so
  // whichever runs last discards the other's output. Recorded, not resolved.
  { script: 'scripts/08-cartography.mjs', inputs: ['web/data.json'], outputs: ['web/cartography.json'], needs: [] },
  { script: 'scripts/09-real-osm-forests.mjs', inputs: ['web/data.json'], outputs: ['web/cartography.json'], needs: ['Overpass'] },
];

/** Outputs older than something they were built from. */
export function stalenessCheck(mtimes) {
  const stale = [];
  for (const stage of PIPELINE) {
    for (const output of stage.outputs) {
      const outAt = mtimes.get(output);
      if (outAt === undefined) continue;
      for (const input of stage.inputs) {
        const inAt = mtimes.get(input);
        if (inAt === undefined) continue;
        if (outAt < inAt) stale.push({ output, input });
      }
    }
  }
  return stale;
}

/**
 * web/streets/manifest.json maps city index -> geonameid. Indices are
 * positional, so growing the roster reorders them and silently repoints every
 * entry. web/app.js:286 takes the city's position from the current graph and
 * web/app.js:291 takes its street geometry from this manifest, so a
 * disagreement draws one city's streets at another city's location.
 */
export function manifestAgreement(manifest, cities) {
  let agree = 0;
  const disagree = [];
  const entries = Object.entries(manifest);
  for (const [indexStr, gid] of entries) {
    const index = Number(indexStr);
    const city = cities[index];
    const graphGid = city ? String(city.geonameid) : 'missing';
    if (graphGid === String(gid)) agree++;
    else disagree.push({ index, manifestGid: String(gid), graphGid });
  }
  return { checked: entries.length, agree, disagree };
}

/** City indices a puzzle set references that the graph does not have. */
export function puzzleIndexCheck(puzzles, cityCount) {
  const bad = new Set();
  for (const p of puzzles) {
    if (!(p.a >= 0 && p.a < cityCount)) bad.add(p.a);
    if (!(p.b >= 0 && p.b < cityCount)) bad.add(p.b);
  }
  return [...bad].sort((x, y) => x - y);
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `node --test tests/data-doctor.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dag.mjs tests/data-doctor.test.mjs
git commit -m "feat: encode the build pipeline DAG and its consistency rules"
```

---

### Task 5: data-doctor CLI and the data:map ordering fix

**Files:**
- Create: `scripts/data-doctor.mjs`
- Modify: `package.json` (fix `data:map`, add `doctor`)

**Interfaces:**
- Consumes: `PIPELINE`, `stalenessCheck`, `manifestAgreement`, `puzzleIndexCheck` from `scripts/lib/dag.mjs`
- Produces: `npm run doctor` — exit 1 on any inconsistency.

- [ ] **Step 1: Write the CLI**

Create `scripts/data-doctor.mjs`:

```js
#!/usr/bin/env node
// Cheap consistency check over the pipeline's artefacts. Rebuilds nothing —
// answers "is what is on disk self-consistent?" fast enough to run before every
// commit that touches data/.

import { readFileSync, statSync } from 'node:fs';
import {
  PIPELINE, stalenessCheck, manifestAgreement, puzzleIndexCheck,
} from './lib/dag.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

let failed = false;
const fail = (msg) => { failed = true; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

// --- staleness ---------------------------------------------------------------
const mtimes = new Map();
for (const stage of PIPELINE) {
  for (const p of [...stage.inputs, ...stage.outputs]) {
    if (mtimes.has(p)) continue;
    try { mtimes.set(p, statSync(new URL(p, ROOT)).mtimeMs); } catch { /* absent */ }
  }
}

console.log('\n=== staleness ===');
const stale = stalenessCheck(mtimes);
if (!stale.length) ok('every artefact is newer than its inputs');
for (const s of stale) fail(`${s.output} is older than ${s.input} — rebuild it`);

// --- puzzle indices ----------------------------------------------------------
console.log('\n=== puzzles vs graph ===');
let graph, pack;
try {
  graph = read('data/graph.json');
  pack = read('data/puzzles.json');
} catch (e) {
  console.error(`data-doctor: cannot read data/graph.json or data/puzzles.json: ${e.message}`);
  process.exit(2);
}
const badIndices = puzzleIndexCheck(pack.puzzles, graph.cities.length);
if (badIndices.length) {
  fail(`${badIndices.length} city indices referenced by puzzles are not in the graph `
    + `(${badIndices.slice(0, 5).join(', ')}${badIndices.length > 5 ? ', …' : ''}) `
    + '— reselect with npm run data:puzzles');
} else ok(`${pack.puzzles.length} puzzles reference only cities the graph has`);

// --- street manifest ---------------------------------------------------------
console.log('\n=== street manifest vs graph ===');
try {
  const { checked, agree, disagree } = manifestAgreement(
    read('web/streets/manifest.json'), graph.cities,
  );
  if (disagree.length) {
    fail(`${disagree.length} of ${checked} manifest entries point at a different city `
      + 'than the graph has at that index — the game draws the wrong city\'s streets '
      + '(web/app.js:286 takes position from the graph, :291 takes geometry from here). '
      + 'Rebuild with npm run data:streets');
    for (const d of disagree.slice(0, 5)) {
      const name = graph.cities[d.index]?.name ?? '(no such city)';
      console.log(`          index ${d.index}: manifest ${d.manifestGid} vs graph ${name} ${d.graphGid}`);
    }
  } else ok(`all ${agree} manifest entries agree with the graph`);
  const missing = graph.cities.length - checked;
  if (missing > 0) {
    console.log(`  warn  ${missing} cities have no street data (manifest covers ${checked} of ${graph.cities.length})`);
  }
} catch {
  console.log('  warn  no web/streets/manifest.json — street detail not built');
}

// --- output ownership --------------------------------------------------------
console.log('\n=== output ownership ===');
const owners = new Map();
for (const stage of PIPELINE) {
  for (const out of stage.outputs) {
    if (!owners.has(out)) owners.set(out, []);
    owners.get(out).push(stage.script);
  }
}
let contested = false;
for (const [out, scripts] of owners) {
  if (scripts.length > 1) {
    contested = true;
    console.log(`  warn  ${out} is written in full by ${scripts.join(' and ')} — whichever runs last wins`);
  }
}
if (!contested) ok('every output has exactly one producer');

process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Fix the ordering bug and add the script**

In `package.json`, change `data:map` from:

```json
"data:map": "node scripts/03-map.mjs && python3 scripts/04-terrain.py && node scripts/05-bundle.mjs"
```

to:

```json
"data:map": "node scripts/03-map.mjs && node scripts/05-bundle.mjs && python3 scripts/04-terrain.py"
```

and add:

```json
"doctor": "node scripts/data-doctor.mjs"
```

`scripts/04-terrain.py:72` reads `web/data.json`, which `05-bundle` writes. The
old order fed it the previous run's bundle and would fail on a clean checkout.

- [ ] **Step 3: Run it against real data**

Run: `npm run doctor`

Expected: exit 1, with the street-manifest check reporting **477 of 479**
entries disagreeing — the live bug this tool exists to find, confirmed at plan
time — and a warning that `web/cartography.json` has two producers. Puzzle
indices should pass (838 cities, max index 837).

If the manifest check reports 0 disagreements the check is wrong. Verify by
hand against `data/graph.json` before believing it.

- [ ] **Step 4: Commit**

```bash
git add scripts/data-doctor.mjs package.json
git commit -m "feat: add pipeline consistency check; fix data:map stage ordering"
```

---

### Task 6: Balance library

**Files:**
- Create: `scripts/lib/balance.mjs`
- Test: `tests/balance.test.mjs`

**Interfaces:**
- Produces:
  - `readCriteria(pack)` → the `criteria` object; throws if absent.
  - `checkShippedSet(pack, cityCount)` → `{ total, shortestRoadWins, trapFailures, boundsFailures, badIndices }`, where each `*Failures` is `Array<{index, reason}>` and `badIndices` is `number[]`.
  - `sweepRow(runs, multiplier)` → `{ multiplier, shortWins, shortWinRate, readerWins, readerWinRate, medMarginMin, medBustMin }`. `runs` is the cached shape from `play/calibrate-hos.mjs:99-103`: `{ a, b, optMin, short, reader: number[] }`.
  - `findCliff(runs, multipliers)` → `number | null` — lowest multiplier whose `shortWins` exceeds zero.
  - `formatSpecTable(rows)` → markdown for pasting at `docs/SPEC.md:213`.

`checkShippedSet` is arithmetic over `data/puzzles.json` and needs no bot runs,
which is what makes the default mode instant.

- [ ] **Step 1: Write the failing tests**

Create `tests/balance.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readCriteria, checkShippedSet, sweepRow, findCliff, formatSpecTable,
} from '../scripts/lib/balance.mjs';

const CRITERIA = {
  MIN_SHORTEST_PENALTY: 1.12,
  MAX_WORST_RATIO: 1.45,
  MAX_STUCK_RATE: 0.15,
  MIN_HOURS: 12, MAX_HOURS: 40,
  MIN_HOPS: 7, MAX_HOPS: 16,
};

/** Passes everything: 20h optimal, shortest 1.2x that, budget 1.11x. */
const good = { a: 0, b: 1, optimalMin: 1200, shortestMin: 1440, budgetMin: 1332, hops: 10 };
const pack = (puzzles) => ({ criteria: CRITERIA, puzzles });

test('readCriteria throws rather than defaulting when the block is missing', () => {
  assert.throws(() => readCriteria({ puzzles: [] }), /criteria/);
});

test('readCriteria returns the block when present', () => {
  assert.equal(readCriteria(pack([])).MIN_SHORTEST_PENALTY, 1.12);
});

test('a sound puzzle set passes every check', () => {
  const out = checkShippedSet(pack([good]), 10);
  assert.equal(out.total, 1);
  assert.equal(out.shortestRoadWins.length, 0);
  assert.equal(out.trapFailures.length, 0);
  assert.equal(out.boundsFailures.length, 0);
  assert.deepEqual(out.badIndices, []);
});

test('a puzzle the shortest road wins outright is caught', () => {
  // shortest 1300 comes in under the 1332 budget
  const out = checkShippedSet(pack([{ ...good, shortestMin: 1300 }]), 10);
  assert.equal(out.shortestRoadWins.length, 1);
  assert.equal(out.shortestRoadWins[0].index, 0);
});

test('a puzzle below the trap ratio is caught', () => {
  // 1300/1200 = 1.083, under the 1.12 floor
  const out = checkShippedSet(pack([{ ...good, shortestMin: 1300 }]), 10);
  assert.equal(out.trapFailures.length, 1);
});

test('a puzzle outside the hours bound is caught', () => {
  const out = checkShippedSet(pack([
    { ...good, optimalMin: 600, shortestMin: 720, budgetMin: 666 },
  ]), 10);
  assert.equal(out.boundsFailures.length, 1);
  assert.match(out.boundsFailures[0].reason, /hours/);
});

test('a puzzle outside the hops bound is caught', () => {
  const out = checkShippedSet(pack([{ ...good, hops: 3 }]), 10);
  assert.equal(out.boundsFailures.length, 1);
  assert.match(out.boundsFailures[0].reason, /hops/);
});

test('an out-of-range city index is caught', () => {
  const out = checkShippedSet(pack([{ ...good, b: 99 }]), 10);
  assert.deepEqual(out.badIndices, [99]);
});

test('sweepRow counts a shortest-road win only at a generous multiplier', () => {
  const runs = [{ a: 0, b: 1, optMin: 1000, short: 1150, reader: [1050, 1200] }];
  assert.equal(sweepRow(runs, 1.20).shortWins, 1);
  assert.equal(sweepRow(runs, 1.10).shortWins, 0);
});

test('sweepRow counts reader wins over finished runs only', () => {
  const runs = [{ a: 0, b: 1, optMin: 1000, short: 1200, reader: [1050, Infinity] }];
  const row = sweepRow(runs, 1.10);
  assert.equal(row.readerWins, 1);
  assert.equal(row.readerWinRate, 1);
});

test('findCliff returns the lowest multiplier where the shortest road first wins', () => {
  const runs = [{ a: 0, b: 1, optMin: 1000, short: 1150, reader: [1050] }];
  assert.equal(findCliff(runs, [1.08, 1.10, 1.12, 1.15, 1.20]), 1.15);
});

test('findCliff returns null when the shortest road never wins', () => {
  const runs = [{ a: 0, b: 1, optMin: 1000, short: 2000, reader: [1050] }];
  assert.equal(findCliff(runs, [1.08, 1.10, 1.12]), null);
});

test('formatSpecTable emits a markdown table with a header row', () => {
  const table = formatSpecTable([
    sweepRow([{ a: 0, b: 1, optMin: 1000, short: 1200, reader: [1050] }], 1.11),
  ]);
  assert.match(table, /\| multiplier \|/);
  assert.match(table, /\| 1\.11 \|/);
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `node --test tests/balance.test.mjs`
Expected: FAIL — cannot find module `../scripts/lib/balance.mjs`.

- [ ] **Step 3: Implement the library**

Create `scripts/lib/balance.mjs`:

```js
// The spec's difficulty criteria, made executable. Pure — no I/O, no logging.
//
// Thresholds are never hardcoded: they come from the puzzle pack's own
// `criteria` block, which is what generated the set. That makes this check
// incapable of drifting from the data it checks. See docs/SPEC.md:157-194.

/** The criteria block, or an explicit failure. Never a silent default. */
export function readCriteria(pack) {
  if (!pack.criteria) {
    throw new Error(
      'data/puzzles.json has no `criteria` block — regenerate it with '
      + '`npm run data:puzzles`. Refusing to check against assumed thresholds.',
    );
  }
  return pack.criteria;
}

/**
 * Every check that is pure arithmetic over the shipped set. No bot runs, so
 * this stays in milliseconds even at 9,310 puzzles.
 */
export function checkShippedSet(pack, cityCount) {
  const c = readCriteria(pack);
  const shortestRoadWins = [];
  const trapFailures = [];
  const boundsFailures = [];
  const bad = new Set();

  pack.puzzles.forEach((p, index) => {
    // Criterion 1, the load-bearing one: the shortest road is a free,
    // deterministic strategy. If it comes in under budget, the puzzle is not a
    // puzzle. docs/SPEC.md:161-173.
    if (p.shortestMin <= p.budgetMin) {
      shortestRoadWins.push({ index, reason: `shortest ${p.shortestMin} <= budget ${p.budgetMin}` });
    }
    const ratio = p.shortestMin / p.optimalMin;
    if (ratio < c.MIN_SHORTEST_PENALTY) {
      trapFailures.push({ index, reason: `trap ratio ${ratio.toFixed(3)} < ${c.MIN_SHORTEST_PENALTY}` });
    }
    const hours = p.optimalMin / 60;
    if (hours < c.MIN_HOURS || hours > c.MAX_HOURS) {
      boundsFailures.push({ index, reason: `${hours.toFixed(1)} hours outside ${c.MIN_HOURS}-${c.MAX_HOURS}` });
    } else if (p.hops < c.MIN_HOPS || p.hops > c.MAX_HOPS) {
      boundsFailures.push({ index, reason: `${p.hops} hops outside ${c.MIN_HOPS}-${c.MAX_HOPS}` });
    }
    for (const i of [p.a, p.b]) if (!(i >= 0 && i < cityCount)) bad.add(i);
  });

  return {
    total: pack.puzzles.length,
    shortestRoadWins,
    trapFailures,
    boundsFailures,
    badIndices: [...bad].sort((x, y) => x - y),
  };
}

const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);

/**
 * One row of the multiplier sweep. `runs` is the cached shape produced by
 * play/calibrate-hos.mjs:99-103 — { a, b, optMin, short, reader: number[] }.
 */
export function sweepRow(runs, multiplier) {
  let shortWins = 0, readerWins = 0, finished = 0;
  const margins = [], busts = [];
  for (const r of runs) {
    const budget = r.optMin * multiplier;
    if (r.short <= budget) shortWins++;
    for (const t of r.reader) {
      if (!Number.isFinite(t)) continue;
      finished++;
      if (t <= budget) { readerWins++; margins.push(budget - t); } else busts.push(t - budget);
    }
  }
  return {
    multiplier,
    shortWins,
    shortWinRate: runs.length ? shortWins / runs.length : 0,
    readerWins,
    readerWinRate: finished ? readerWins / finished : 0,
    medMarginMin: median(margins),
    medBustMin: median(busts),
  };
}

/**
 * The lowest swept multiplier at which the shortest road starts getting away
 * with it. docs/SPEC.md:221-224 requires the shipped multiplier to sit below
 * this by "one road's worth of margin", made numeric by the caller.
 */
export function findCliff(runs, multipliers) {
  for (const m of [...multipliers].sort((x, y) => x - y)) {
    if (sweepRow(runs, m).shortWins > 0) return m;
  }
  return null;
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const hrs = (m) => `${(m / 60).toFixed(1)}h`;

/** The markdown table for pasting into docs/SPEC.md at line 213. */
export function formatSpecTable(rows) {
  const head = '| multiplier | shortest-road player wins | road-reader wins | median win margin | median bust |\n'
    + '| --- | --- | --- | --- | --- |';
  const body = rows.map((r) => `| ${r.multiplier.toFixed(2)} | ${pct(r.shortWinRate)} `
    + `| ${pct(r.readerWinRate)} | ${hrs(r.medMarginMin)} | ${hrs(r.medBustMin)} |`);
  return [head, ...body].join('\n');
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `node --test tests/balance.test.mjs`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/balance.mjs tests/balance.test.mjs
git commit -m "feat: make the spec's difficulty criteria executable"
```

---

### Task 7: balance-check CLI

**Files:**
- Create: `play/balance-check.mjs`
- Modify: `package.json` (add `balance`)

**Interfaces:**
- Consumes: `checkShippedSet`, `sweepRow`, `findCliff`, `formatSpecTable` from `scripts/lib/balance.mjs`; `buildGraph` from `scripts/lib/graph.mjs:6`; `roadReader` from `play/bots.mjs:220`
- Produces: `npm run balance` and `npm run balance -- --sweep`.

- [ ] **Step 1: Write the CLI**

Create `play/balance-check.mjs`:

```js
#!/usr/bin/env node
// Is this still the game docs/SPEC.md describes?
//
//   npm run balance             the shipped set plus a bot sample — seconds
//   npm run balance -- --sweep  also the multiplier cliff — needs the cache
//
// The sweep reuses play/calibrate-hos.mjs's cache and never builds it: if the
// cache is absent it says so. That keeps this from silently costing 20 minutes.

import { readFileSync, existsSync } from 'node:fs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { roadReader } from './bots.mjs';
import { checkShippedSet, sweepRow, findCliff, formatSpecTable } from '../scripts/lib/balance.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

const SWEEP = process.argv.includes('--sweep');
const SAMPLE = 200;
const TRIALS = 6;
const CLIFF_MARGIN = 0.02; // docs/SPEC.md:221-224, "one road's worth of margin"
const MULTIPLIERS = [1.08, 1.09, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15];
const SPEC_WIN_RATE = 0.52; // docs/SPEC.md:217

let pack, g;
try {
  pack = read('data/puzzles.json');
  g = buildGraph(read('data/graph.json'));
} catch (e) {
  console.error(`balance-check: cannot read data/puzzles.json or data/graph.json: ${e.message}`);
  process.exit(2);
}

let failed = false;
const fail = (msg) => { failed = true; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const show = (list) => list.slice(0, 5).forEach((f) => console.log(`          #${f.index}: ${f.reason}`));

console.log(`\n=== shipped set: ${pack.puzzles.length} puzzles, `
  + `multiplier ${pack.budgetMultiplier}, ${g.n} cities ===`);

// checkShippedSet calls readCriteria internally, which throws if data/puzzles.json
// has no `criteria` block (see scripts/lib/balance.mjs) — that is "the tool cannot
// run its checks," not "a check failed," so it exits 2, not 1.
let r;
try {
  r = checkShippedSet(pack, g.n);
} catch (e) {
  console.error(`balance-check: ${e.message}`);
  process.exit(2);
}

if (r.badIndices.length) {
  fail(`${r.badIndices.length} city indices are not in the graph — reselect with npm run data:puzzles`);
} else ok('every puzzle references a city the graph has');

if (r.shortestRoadWins.length) {
  fail(`the shortest road wins outright on ${r.shortestRoadWins.length} puzzles `
    + `(${pct(r.shortestRoadWins.length / r.total)}) — these are not puzzles. `
    + 'Reselect; do not lower the multiplier.');
  show(r.shortestRoadWins);
} else ok('the shortest road wins nothing');

if (r.trapFailures.length) {
  fail(`${r.trapFailures.length} puzzles are below the trap ratio`);
  show(r.trapFailures);
} else ok(`every puzzle clears the ${pack.criteria.MIN_SHORTEST_PENALTY} trap ratio`);

if (r.boundsFailures.length) {
  fail(`${r.boundsFailures.length} puzzles are outside the hours/hops bounds`);
  show(r.boundsFailures);
} else ok('every puzzle is within the hours and hops bounds');

// --- the simulated player, on a deterministic sample --------------------------
console.log(`\n=== simulated player: ${SAMPLE} puzzles x ${TRIALS} runs ===`);
const step = Math.max(1, Math.floor(pack.puzzles.length / SAMPLE));
const sample = pack.puzzles.filter((_, i) => i % step === 0).slice(0, SAMPLE);

let wins = 0, finished = 0, stuck = 0, worstRatio = 0;
for (const p of sample) {
  for (let t = 0; t < TRIALS; t++) {
    const run = roadReader(g, p.a, p.b, { seed: p.a * 977 + p.b * 13 + t, hos: true });
    if (run.stuck) { stuck++; continue; }
    finished++;
    if (run.minutes <= p.budgetMin) wins++;
    worstRatio = Math.max(worstRatio, run.minutes / p.optimalMin);
  }
}

const total = sample.length * TRIALS;
const winRate = finished ? wins / finished : 0;
const stuckRate = total ? stuck / total : 0;
console.log(`  win rate ${pct(winRate)} of ${finished} finished runs`);
console.log(`  dead-end rate ${pct(stuckRate)} (selection cap ${pct(pack.criteria.MAX_STUCK_RATE)})`);
console.log(`  worst finishing ratio ${worstRatio.toFixed(2)}x (selection cap ${pack.criteria.MAX_WORST_RATIO}x)`);

if (stuckRate > pack.criteria.MAX_STUCK_RATE) {
  fail(`dead-end rate over the ${pct(pack.criteria.MAX_STUCK_RATE)} cap`);
}
if (winRate < 0.30) fail(`win rate ${pct(winRate)} — the game is unwinnable, not merely hard`);
if (winRate > 0.75) fail(`win rate ${pct(winRate)} — the budget is no longer binding`);
if (Math.abs(winRate - SPEC_WIN_RATE) > 0.03) {
  console.log(`  warn  win rate has moved more than 3 points from the ${pct(SPEC_WIN_RATE)} at docs/SPEC.md:217`);
}
if (worstRatio > pack.criteria.MAX_WORST_RATIO) {
  console.log(`  warn  worst finishing ratio exceeds the selection cap — expected on a `
    + 're-run with different seeds, but investigate if it is far over');
}

// --- the cliff, opt-in -------------------------------------------------------
if (SWEEP) {
  console.log('\n=== multiplier sweep ===');
  const CACHE = new URL('data/.calibrate-hos-cache.json', ROOT);
  if (!existsSync(CACHE)) {
    console.log('  no sweep cache — run `npm run calibrate:hos` first (~20 min)');
    process.exit(failed ? 1 : 0);
  }
  const { runs } = JSON.parse(readFileSync(CACHE, 'utf8'));
  console.log(formatSpecTable(MULTIPLIERS.map((m) => sweepRow(runs, m))));

  const cliff = findCliff(runs, MULTIPLIERS);
  if (cliff === null) {
    console.log(`\n  no cliff at or below ${MULTIPLIERS.at(-1)} — widen the swept range to find it`);
  } else {
    const margin = cliff - pack.budgetMultiplier;
    console.log(`\n  cliff at ${cliff.toFixed(2)}, shipped multiplier ${pack.budgetMultiplier}, `
      + `margin ${margin.toFixed(2)}`);
    if (margin < CLIFF_MARGIN) {
      fail(`margin ${margin.toFixed(2)} is under the ${CLIFF_MARGIN} minimum (docs/SPEC.md:221-224)`);
    } else ok(`margin clears the ${CLIFF_MARGIN} minimum`);
  }
  console.log('\n  paste the table at docs/SPEC.md:213 if these numbers have moved.');
}

process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"balance": "node play/balance-check.mjs"
```

- [ ] **Step 3: Run the fast path**

Run: `npm run balance`

Expected: completes in seconds. The arithmetic checks cover all 9,310 puzzles;
the sampled section reports a win rate.

This is the first re-measurement since the roster grew from 479 to 838 cities.
A failure is a real finding about the current data, not necessarily a tool bug
— read the reported indices and check one by hand in `data/puzzles.json` before
changing either.

If the run exceeds about 60 seconds, lower `SAMPLE` and record the new value.
Do not leave behind a check nobody will run.

- [ ] **Step 4: Run the sweep path**

Run: `npm run balance -- --sweep`

Expected: if `data/.calibrate-hos-cache.json` is absent, a clear instruction to
run `npm run calibrate:hos` first, then exit on the fast-path result.

If the cache exists it was built against the *old* 479-city roster, so its
`runs` reference city indices that no longer mean the same thing. Report that
and recommend deleting it; do not present its numbers as current.

- [ ] **Step 5: Commit**

```bash
git add play/balance-check.mjs package.json
git commit -m "feat: add balance-check with fast shipped-set checks and an opt-in cliff sweep"
```

---

### Task 8: The three skill files

**Files:**
- Create: `.claude/skills/balance-check/SKILL.md`
- Create: `.claude/skills/perf-profile/SKILL.md`
- Create: `.claude/skills/rebuild-data/SKILL.md`

**Interfaces:**
- Consumes: the CLIs from Tasks 3, 5 and 7.

Each is thin: when to run the command, and how to read a failure. The
measurement lives in the scripts, which keeps them useful outside a Claude
session.

- [ ] **Step 1: Write the balance-check skill**

Create `.claude/skills/balance-check/SKILL.md`:

```markdown
---
name: balance-check
description: Use when the road graph, the cost model, or the puzzle set has changed — after npm run data:graph or data:puzzles, before merging any data change, or when asked whether the game is still difficult. Verifies the shortest road still loses.
---

# balance-check

The game's premise is that the shortest route is the fastest only 27% of the
time, and that a player who always takes the shortest road loses. That is a
measured property of the current graph, not a design intention, and it stops
being true silently.

## Run it

    npm run balance             # seconds — the shipped set plus a bot sample
    npm run balance -- --sweep  # also the multiplier cliff; needs the calibrate:hos cache

## Reading a failure

**"the shortest road wins outright on N puzzles"** — the most serious result.
Those pairs are not puzzles: a player wins with zero judgement. Fix by
reselecting (`npm run data:puzzles`), never by lowering the budget multiplier.
docs/SPEC.md:226-233 measured patching budgets in place as leaving 8.5% of a
set broken.

**"margin under the 0.02 minimum"** — the multiplier has drifted too close to
where the shortest road starts winning. Lower it and reselect.

**"win rate has moved more than 3 points"** — a warning. If the move is real
and intended, regenerate the table with `--sweep` and paste it at
docs/SPEC.md:213. Never let a script write that table: the prose around it
carries reasoning that cannot be regenerated.

## The rule that matters

A graph or cost-model change forces puzzle *reselection*. There is no case
where patching an existing set's budgets is correct. See [[rebuild-data]].
```

- [ ] **Step 2: Write the perf-profile skill**

Create `.claude/skills/perf-profile/SKILL.md`:

```markdown
---
name: perf-profile
description: Use after changing anything under web/, after any raster or cartography rebuild, or when asked whether the game has got heavier. Audits what a player downloads and finds assets shipped but never loaded.
---

# perf-profile

    npm run perf

Walks outward from `web/index.html`, following references transitively, and
splits everything in `web/` into eager (reachable from the entry point),
deferred (reached only through a manifest) and orphaned (reachable from
nothing). Then checks totals against `web/perf-budget.json`.

## Reading a failure

**"shipped but reachable from nothing"** — a file every visitor downloads on
deploy and the game never opens. Either wire it up or delete it along with the
pipeline stage that builds it. Add it to `knownOrphans` only as a deliberate
decision to keep shipping dead weight, with a reason.

**"over budget"** — decide whether the growth is worth it. If it is, edit
`web/perf-budget.json` in the same commit as the change that caused it, so the
move is reviewable. Never raise a budget just to get a green run.

## Known state

The eager payload is about 17.9 MB, dominated by `forest-detail.webp` at
9.7 MB. The budget records that rather than endorsing it — the tool's job is
catching growth. Shrinking that number is worthwhile work in its own right.

## Scope

Static analysis only: no browser, no frame timing. It catches payload and
draw-loop-input regressions, which is where growth has actually come from. If
the map starts feeling slow while these numbers stay flat, that is the signal
to add real frame measurement.
```

- [ ] **Step 3: Write the rebuild-data skill**

Create `.claude/skills/rebuild-data/SKILL.md`:

```markdown
---
name: rebuild-data
description: Use before or after rebuilding any generated data — cities, graph, puzzles, map, terrain, streets, cartography. Encodes which stages depend on which, what must be rerun after a change, and the reselection rule.
---

# rebuild-data

## Check first

    npm run doctor

Cheap. Catches stale artefacts, puzzles referencing cities that no longer
exist, and a street manifest whose indices have shifted out from under it.

## The dependency graph

    data/raw/cities15000.txt
      00-cities ──────────────> data/cities.json
        01-graph [OSRM] ──────> data/graph.json
          02-puzzles ─────────> data/puzzles.json
          03-map ─────────────> data/map.json
          06-road-names [OSRM]> data/road-names.json
          07-streets [Overpass]> web/streets/*.json + manifest.json

      05-bundle (graph+map+puzzles+road-names) ──> web/data.json
        04-terrain.py       ──> terrain*.webp, terrain-tiles.json
        10-water-raster.py  ──> water*.webp
        11-urban-satellite  ──> urban-*.webp
        08-cartography      ──> web/cartography.json
        09-real-osm-forests ──> web/cartography.json

`web/data.json` is both the fan-in of the Node stages and the input to every
raster stage, so `05-bundle` must run before any of them.

## If you changed…

| …this | rerun |
| --- | --- |
| the city roster (`00-cities`) | everything, including streets |
| the graph or cost model (`01-graph`) | everything downstream, and **reselect puzzles** |
| puzzle criteria (`02-puzzles`) | `02-puzzles`, `05-bundle` |
| map extent or projection (`03-map`) | `03-map`, `05-bundle`, then every raster |
| a raster script only | that raster |

## The reselection rule

**A graph or cost-model change forces puzzle reselection.** Never patch an
existing set's budgets in place. docs/SPEC.md:226-233 measured doing that to
the pre-driving-hours set as leaving 8.5% of it with the shortest road winning
outright. Verify with [[balance-check]] afterwards.

## Known hazards

- **City indices are positional.** Growing the roster reorders them, which
  silently repoints `web/streets/manifest.json` at the wrong cities. Rebuilding
  the roster without rebuilding streets is how that happens. `npm run doctor`
  catches it.
- **`web/cartography.json` has two producers.** `08-cartography` and
  `09-real-osm-forests` both write it in full and neither reads it back, so
  whichever runs last discards the other's output. Unresolved; `npm run doctor`
  warns.
- **External services:** OSRM for `01`, `03`, `06`; Overpass for `07` and `09`.
  `07-streets` takes roughly 50 minutes against public mirrors.
```

- [ ] **Step 4: Verify the skills load**

Run: `ls .claude/skills/*/SKILL.md`
Expected: three paths.

Confirm each file's frontmatter has `name` and `description`, and that `name`
matches its directory.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills
git commit -m "feat: add balance-check, perf-profile and rebuild-data skills"
```

---

## Verification

After Task 8:

```bash
npm test          # expect: 35 tests pass
npm run perf      # expect: exit 1 — orphans reported
npm run doctor    # expect: exit 1 — street manifest mismapping reported
npm run balance   # expect: first re-measurement since the roster grew
```

`npm run perf` and `npm run doctor` are **expected to fail** on the current
tree: they are finding real, pre-existing bugs. Report what they find. Do not
fix the underlying data bugs as part of this plan, and do not soften budgets or
checks to make them pass — those are separate decisions for the author.
