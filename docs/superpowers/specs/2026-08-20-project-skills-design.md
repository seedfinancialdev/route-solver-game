# Project skills: balance-check, perf-profile, rebuild-data, cartography bible

Design, 2026-08-20.

Four pieces of project-specific tooling. Each replaces something that is
currently either a manual habit or an undocumented assumption. None of them
invent new measurement: they make the measurement that already exists in
`play/` and `docs/SPEC.md` runnable and enforceable.

## Why these four

The pipeline produces artefacts that silently invalidate each other, and the
game's difficulty is a measured property that no longer gets re-measured. Three
concrete instances, all found while writing this spec:

1. `npm run data:map` runs its stages in an order that cannot work on a clean
   checkout (see Bug 1).
2. Two pipeline stages overwrite the same output file (see Bug 2).
3. ~1.5 MB of committed, deployed assets are fetched by nothing (see Bug 3).

None of these are visible from the code you'd read while working on a feature.
All three are mechanically detectable.

## Ground truth as of this spec

Measured, not assumed. These numbers are the baseline the tools calibrate
against; they are expected to change, which is the point.

**Graph and puzzles**

| | |
| --- | --- |
| `data/graph.json` | 838 cities, 2,160 edges |
| `data/puzzles.json` | 9,310 puzzles, generated 2026-08-20 |
| max city index referenced by puzzles | 837 (in range) |

`data/puzzles.json` already carries a machine-readable contract in its
metadata, which is the single most useful fact for `balance-check`:

```json
{
  "budgetMultiplier": 1.11,
  "hos": { "continuousLimitMin": 270, "breakMin": 45 },
  "criteria": {
    "MIN_SHORTEST_PENALTY": 1.12,
    "MAX_WORST_RATIO": 1.45,
    "MAX_STUCK_RATE": 0.15,
    "MIN_HOURS": 12, "MAX_HOURS": 40,
    "MIN_HOPS": 7, "MAX_HOPS": 16
  }
}
```

**Web payload** — `web/` totals 56 MB.

| file | size | fetched by |
| --- | --- | --- |
| `forest-detail.webp` | 9,669 KB | `map/terrain-layer.js:58` |
| `terrain-detail.webp` | 3,088 KB | `map/terrain-layer.js:42`, `app.js` |
| `data.json` | 2,731 KB | `app.js`, `map/map-engine.js` |
| `forest.webp` | 1,698 KB | `map/terrain-layer.js:50` |
| `cartography.json` | 750 KB | **nothing** |
| `water-detail.webp` | 612 KB | **nothing** |
| `terrain.webp` | 594 KB | `index.html:61`, `map/terrain-layer.js:34` |
| `water.webp` | 183 KB | **nothing** |
| `app.js` | 63 KB | `index.html` |
| `app.css` | 34 KB | `index.html` |
| `engine.js` | 18 KB | `index.html` |
| `terrain-tiles.json` | 3 KB | `map/terrain-layer.js:65` |
| `web/terrain/*.webp` | 6×6 grid | `map/terrain-layer.js:87`, on demand |
| `web/streets/*.json` | 480 files, 4.2 MB, largest 26 KB | `app.js` via `streets/manifest.json` |

Asset references use `?v=` cache-busting template literals
(`` `../forest.webp?v=${v}` ``), so any scanner must match the path prefix,
not a quoted literal ending in the extension.

## The pipeline DAG

Derived from the actual `readFileSync`/`writeFileSync` sites, not from the npm
script names.

```
data/raw/cities15000.txt
  └─ 00-cities ──────────────────────> data/cities.json
       └─ 01-graph [OSRM] ───────────> data/graph.json
            ├─ 02-puzzles ───────────> data/puzzles.json
            ├─ 03-map ───────────────> data/map.json      (+ data/raw/ne_*.geojson)
            ├─ 06-road-names [OSRM] ─> data/road-names.json
            └─ 07-streets [Overpass]─> web/streets/*.json + manifest.json

  05-bundle (graph + map + puzzles + road-names) ──> web/data.json     ← fan-in
       ├─ 04-terrain.py       ──> terrain.webp, terrain-detail.webp, terrain/*.webp
       ├─ 10-water-raster.py  ──> water.webp, water-detail.webp
       ├─ 11-urban-satellite  ──> urban-day.webp, urban-night.webp
       ├─ 08-cartography      ──> web/cartography.json
       └─ 09-real-osm-forests ──> web/cartography.json
```

`web/data.json` is both the fan-in of the Node stages and the fan-out to every
raster stage. Any change at `00-cities` or `01-graph` therefore invalidates
everything, including all rasters.

### Bug 1 — `data:map` is ordered wrong

`package.json` defines:

```
"data:map": "node scripts/03-map.mjs && python3 scripts/04-terrain.py && node scripts/05-bundle.mjs"
```

`scripts/04-terrain.py:72` reads `web/data.json`, which `05-bundle` writes as
the *last* step. Every run consumes the previous run's bundle; on a clean
checkout it fails outright.

**Fix:** reorder to `03-map && 05-bundle && 04-terrain`. Ships as part of
`rebuild-data`.

### Bug 2 — two stages own the same file

`08-cartography.mjs` and `09-real-osm-forests.mjs` both write
`web/cartography.json` in full. `09-real-osm-forests.mjs:16` reads only
`web/data.json`, never the existing `cartography.json`, and
`09-real-osm-forests.mjs:92` writes the whole file. There is no
read-modify-write, so whichever runs last discards the other's output.

**Fix:** out of scope to resolve the ownership question here — that is a design
decision about what `cartography.json` should contain. `rebuild-data` documents
the constraint and `data-doctor` flags the ambiguity; the merge-vs-replace call
stays with the author.

### Bug 3 — orphaned deployed assets

`web/cartography.json`, `web/water.webp` and `web/water-detail.webp` have no
fetch site in any shipped client file. `cartography-layer.js` is imported and
instantiated by `map-engine.js:10,35` but contains no `fetch` or `Image()` call
at all. That is 1,545 KB committed and deployed but never loaded, produced by
two pipeline stages.

**Fix:** `perf-profile` reports it. Deleting versus wiring up is the author's
call, not the tool's.

## Deliverable 1 — `balance-check`

`play/balance-check.mjs` plus `.claude/skills/balance-check/SKILL.md`.

**Job.** Answer "is this still the game the spec describes?" against the
current graph, in one command.

**Thresholds come from `data/puzzles.json`'s own `criteria` block, not from
constants in the script.** The set was generated under those thresholds, so
reading them back makes the check incapable of drifting from what produced the
data. The script fails if the block is missing rather than falling back to
defaults.

**Reuses, does not reimplement:** `buildGraph`, `dijkstra`, `pathFrom`,
`hosDijkstra` from `scripts/lib/graph.mjs`; `shortestRouter` and `roadReader`
from `play/bots.mjs`. The sweep is the one in `play/calibrate.mjs`; this adds
pass/fail and drift reporting around it.

**Hard failures — exit 1:**

| check | source |
| --- | --- |
| any puzzle index ≥ `graph.cities.length` | structural |
| shortest-road win rate > 0% at the shipped multiplier | SPEC.md:221-224 |
| shipped multiplier not ≥ 0.02 below the measured cliff | SPEC.md:221-224 |
| any shipped puzzle below `MIN_SHORTEST_PENALTY` | SPEC.md:157-173, criterion 1 |
| any shipped puzzle outside the hours/hops bounds | SPEC.md:194 |

The cliff is defined as the lowest swept multiplier at which the shortest-road
win rate first exceeds 0%. The 0.02 margin is the rule stated in SPEC.md
("one road's worth of margin below the cliff"), made numeric.

**Warnings — exit 0, reported:**

- Drift between measured sweep results and the table at SPEC.md:213-219.
- Criterion 2/3/4 statistics moving from the spec's stated figures by more than
  3 percentage points (`roadReader` win rate, currently 52%; dead-end rate) or
  more than 0.05 (worst finishing ratio, currently capped at 1.45).

On drift, print the regenerated markdown table ready to paste at SPEC.md:213.
Never write to SPEC.md — the prose around that table carries reasoning a script
cannot regenerate.

**Cost.** The sweep in `calibrate.mjs` is an all-pairs Dijkstra over 838 nodes
plus 6 trials per candidate pair. `calibrate-hos.mjs` already caches a ~20
minute pool scan to `data/.calibrate-hos-cache.json` (gitignored). If the
default run exceeds roughly 60s, add a `--quick` mode that samples the puzzle
set rather than sweeping exhaustively, and make the full sweep opt-in. Decide
this by measuring during implementation, not now.

**Skill file.** Thin: when to run it (after any `data:graph` or `data:puzzles`
rebuild, before merging a data change), how to read a cliff move versus a
win-rate move, and the standing rule that a failed criterion 1 means reselect
rather than retune the multiplier.

## Deliverable 2 — `perf-profile`

`scripts/perf-profile.mjs`, `web/perf-budget.json` (committed) plus
`.claude/skills/perf-profile/SKILL.md`.

**Job.** Catch payload and draw-loop regressions from disk. No browser, no new
dependencies.

**Classifies every asset in `web/` into three buckets** by scanning the shipped
client for reference sites — matching path prefixes so `?v=` cache-busting is
handled:

- **Eager** — requested during init. Currently `index.html`, `app.css`,
  `app.js`, `engine.js`, `map/*.js`, `data.json`, `terrain.webp`,
  and the detail tier that `terrain-layer.js` kicks off at construction.
- **Deferred** — requested on demand: `web/terrain/*.webp` tiles,
  `web/streets/*.json`.
- **Orphaned** — present, committed, referenced by nothing. Currently the three
  files in Bug 3.

The exact eager/deferred split for the detail tier must be confirmed against
`terrain-layer.js`'s init path during implementation; `terrain-detail.webp` and
`forest-detail.webp` have their `src` set at construction but render
progressively, so they are init-requested rather than on-demand.

**Also reports** street-JSON count and size distribution with the worst
offender named, raster dimensions, and draw-loop input counts (cities, edges,
cartography path and vertex totals) — the numbers that actually drive per-frame
work in `cartography-layer.js` and `gameplay-layer.js`.

**Budgets live in `web/perf-budget.json`**, committed, seeded from today's
measurements. Exceeding a budget is exit 1; a new orphaned asset is exit 1; a
count moving more than 20% without a budget change is a warning. Budgets are
edited deliberately, so a regression shows up as a diff rather than as
something to remember.

**Explicitly out of scope:** frame timing, long tasks, anything needing a
headless browser. Revisit only if these static numbers stop predicting what the
map feels like to drag.

## Deliverable 3 — `rebuild-data`

`.claude/skills/rebuild-data/SKILL.md`, `scripts/data-doctor.mjs`, and the
Bug 1 fix in `package.json`.

**Job.** Make the DAG and the reselection rule impossible to get wrong.

**The rule it enforces**, from SPEC.md:226-233: a change to the graph or the
cost model forces puzzle *reselection*. Patching an old set's budgets in place
is how a puzzle quietly stops being a puzzle — measured at 8.5% of the set
losing outright to the shortest road when this was last done by hand.

**`data-doctor.mjs`** is a cheap consistency check, not a rebuild:

- every artefact's mtime is newer than all of its DAG inputs
- puzzle indices are within `graph.cities.length`
- `web/data.json` is newer than all four of its inputs
- `web/streets/manifest.json` covers the current city roster — this currently
  fails: `web/streets/` holds 479 city files plus `manifest.json`, exactly the
  479-city roster the README still describes, against a graph of 838 cities
- flags the `cartography.json` dual-ownership from Bug 2

Exit 1 on any staleness. Fast enough to run before every commit that touches
`data/`.

**Skill file.** The DAG, which external services each stage needs (OSRM for
`01`/`03`/`06`, Overpass for `07`), rough runtimes, and the decision table for
"I changed X, what must I rerun?" — with reselection called out as mandatory,
never optional, downstream of a graph change.

## Deliverable 4 — `docs/CARTOGRAPHY.md`

**Job.** Say which visual tokens are load-bearing and which are scenery, so the
question stops getting re-litigated. The last five commits are all visual
re-dos; this is the document that ends that loop.

**Load-bearing — frozen without a balance argument:**

- `roadMotorway` / `roadTrunk` / `roadPrimary` / `roadSecondary`, both colour
  **and** width. These encode pace tier, and the README makes the drawn weight
  the player's tell for how fast a road runs. The motorway-to-primary width
  ratio is currently 3.2:1.4 ≈ 2.3:1 in `satelliteTopo`. Changing these changes
  difficulty, which means `balance-check` is the arbiter, not taste.
- `cityNode` vs `cityNodeActive` — scenery city versus one you can act on. Must
  not rely on hue alone.
- `routeLine` / `routeLineGlow` — the committed route at the reveal.

**Scenery — free to retune:** `bg`, `water`, `land`, `forest`, `farmland`,
`urbanDay`, `urbanNight`, `urbanGlow`, `terrainOpacity`, `terrainBlend`,
`coastline`. Single constraint: `roadPrimary` — the lowest pace tier, and the
hardest to see — keeps a contrast ratio of at least 3:1 against every scenery
colour it can be drawn over, after `terrainOpacity` and `terrainBlend` are
applied. 3:1 is the WCAG floor for non-text graphical objects. `perf-profile`
is the wrong home for this check; state it in the bible and verify by hand
until it proves worth automating.

**Structure:** the contract first, then a token table naming what draws each
one, then the settled decisions worth not revisiting.

**Open question flagged, not answered:** `theme-config.js` ships five presets;
`satelliteTopo` is the constructor default. Whether the other four are live
features, debug affordances, or dead code is not determinable from the file and
needs an author decision. The bible records the question rather than guessing.

## What this does not include

- **CI wiring.** `balance-check`, `perf-profile` and `data-doctor` are all
  designed to be CI-shaped (clean exit codes, no interactivity), and gating PRs
  to `main` on them is the obvious follow-up. Deliberately deferred: they should
  run clean locally first, and adding a gate is a separate decision.
- **Fixing Bug 2 or Bug 3.** Both surface real design questions — what
  `cartography.json` is for, whether the water rasters were meant to ship. The
  tools report them; the calls stay with the author.
- **Any browser-based measurement.**

## Build order

1. `docs/CARTOGRAPHY.md` — no dependencies, and it settles vocabulary the
   others reference.
2. `perf-profile` — self-contained, immediately finds Bug 3, cheapest to verify.
3. `rebuild-data` + `data-doctor` + the Bug 1 fix — establishes the DAG that
   `balance-check`'s "when to run" guidance depends on.
4. `balance-check` — largest, needs the most measurement during implementation.
