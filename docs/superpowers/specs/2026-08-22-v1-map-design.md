# The v1 map: what it has to be

2026-08-22. Parent document for map work. Sets the scope that
`2026-08-21-map-representation-design.md` is one narrow slice of.

---

## The problem, stated plainly

What exists today is **terrain relief and a route graph**. That is two layers,
not a map. A player looking at it can see where the mountains are and that some
lines connect some dots. They cannot see where they are, what any road is, what
any place is called, how far anything is, or why any of it matters.

A road atlas is not terrain plus roads. It is a dense, ranked, deliberately
hierarchical information surface where a driver can plan a journey without
being told anything. That is the standard, and the distance to it is most of
the work.

---

## What a road atlas actually carries

Taken from the reference this project has chosen — a physical road atlas —
and split by whether it earns a place here.

| atlas element | carries meaning here? |
| --- | --- |
| Relief / terrain | **Yes** — explains why a good road is slow |
| Road network, ranked by class | **Yes** — the literacy signal itself |
| Settlements ranked by size, **named** | **Yes** — orientation, and the "I know this place" that literacy is made of |
| **Route numbers on shields** | **Yes** — the single most transferable fact on the map |
| **Distances between junctions** | **Yes** — see below; this is the game's own arithmetic |
| Administrative boundaries | **Yes** — jurisdiction is an enforcement channel |
| Water: coast, rivers, lakes | **Yes** — orientation and barrier |
| Land cover: forest, farmland, urban | **Yes** — explains pace, and makes the ground legible |
| Passes, tunnels, ferries | **Yes** — real chokepoints, already half-built as `STRATEGIC_WAYPOINTS` |
| Spot heights, pass altitudes | **Yes** — cheap, and explains the mountain roads |
| Toll roads, service areas | **Later** — belongs with fuel and stops |
| Rail, airports | **No** — the player cannot use them |
| Scenic-route marking | **No** — no mechanic consumes it |

### The distance insight

A Michelin road atlas prints **distances between junctions directly on the
road**. That is its central affordance for a driver: you plan a journey by
adding up numbers printed on the map itself.

This game is *about* planning against a time budget. The per-leg kilometres and
minutes already exist on every edge in `data/graph.json`. Putting them on the
map is not a new data problem — it is the most direct possible expression of
the thing the player is actually doing, and it is currently nowhere.

---

## What the v1 map must let a player do

Three jobs. Everything else is decoration until these work.

**1. Orient.** Know where they are and what they are looking at, without a
label being pushed at them. Requires: settlements ranked and named, borders,
coast and water, physical labels for ranges and rivers, and a graticule.

**2. Decide.** Identify the distinct corridors to their destination and form a
view about which is faster and why. Requires: road class, realised pace, a road
hierarchy legible at planning zoom, per-leg distance and time, chokepoints,
jurisdiction, and eventually risk exposure.

**3. Explain.** Answer "why is that good road slow?" from the map alone.
Requires: relief, land cover, urban density, and borders — read together with
the pace tell.

---

## Where the map is against that

Measured 2026-08-21/22. "SVG" is the shipped renderer, "canvas" is
`web/map/` — which reaches no player and is listed entirely under
`knownOrphans` in `web/perf-budget.json`.

| | SVG | canvas | v1 needs |
| --- | --- | --- | --- |
| Terrain relief | yes | yes, richer | yes, at higher resolution |
| Land cover (forest/water) | partial | yes | yes |
| Road network, curated graph | yes | yes | yes |
| **Realised pace tell** | yes | fixed 2026-08-21 | yes |
| **Road class** | **no data** | **no data** | **required** |
| Settlements named | towns drawn | **not drawn** | required, ranked |
| **Route numbers / shields** | `roadNames` all null | shield layer, no data | **required** |
| **Per-leg distance & time on map** | **no** | **no** | **required** |
| Borders / jurisdiction | drawn, no meaning | drawn, no meaning | required as a channel |
| Physical labels, graticule | yes | **no** | yes |
| Street grids near cities | yes, below 14km | unreachable (140km floor) | yes |
| Chokepoints (passes/tunnels/ferries) | no | alpine passes only | required |
| **Alternative corridors legible** | no | no | **required** |
| **Time as decision info** | no | lighting only | required |
| **Risk exposure** | no | no | required |

Three of the five channels in the cartographic brief are at zero. A fourth is
partial. The two renderers each hold a different half of a map.

---

## Regression to fix: weight stopped stating pace

`2026-08-21-map-representation-design.md` settles it — colour states road TYPE,
weight states PACE. The atlas currently breaks that: colour and width both state
class, which is exactly the redundancy that spec removed.

The reason was defensible at the time. Going all-roads meant the measured pace
tell only existed for 2,160 curated edges, and the OpenMapTiles schema the
vector tiles use carries `class`, `surface`, `toll` and `expressway` but **no
`maxspeed`**. Deriving a speed from class would only have restated the colour.

That reasoning is now out of date. The road graph carries a `kmh` on **every**
edge, real or inferred, with a `maxspeedReal` flag saying which. The tiles do
not have it; we do.

So restoring weight-to-pace means **rendering roads from our own vector tiles**,
built from the graph with speed baked in, rather than from OpenFreeMap's. That
is a real project. It is also the same project that makes speed limits
displayable during a run, which the race needs anyway — see
`2026-08-22-player-experience.md`.

Until then the map is honestly redundant rather than dishonestly invented.

---

## Cheap wins already available

- **3D terrain.** MapLibre renders real terrain off the same `raster-dem`
  source already wired for hillshade; exaggeration is one number. The map
  should feel like relief, not a texture.
- **Time of day.** The ground responding to the departure hour is presentation,
  not simulation, and nothing in the current renderer blocks it. Roads must not
  respond — evidence that changes with the light is decoration
  (`2026-08-21-map-representation-design.md`).
- **Traffic**, when it exists, is a paint property on roads already drawn.

---

## Structural faults to fix, not inherit

1. **Two renderers, neither complete.** The prettier one carries less
   information. v1 needs one.
2. **Basemap and evidence are conflated.** `MAP-SPEC.md`'s layer 2 (a real road
   network as *scenery*) was never built, so the curated gameplay graph has
   been standing in for it. That is why the map looks empty next to a real one,
   and it is also why "add more roads" felt like it threatened the decision
   space — it never did; the two belong on different layers.
3. **Continuity breaks where planning happens.** At 1,200km only 67.2% of each
   corridor is drawn; above 1,800km, 53.0%. A route a third missing cannot be
   traced.
4. **Contrast falls below the floor at continental zoom.** The casing pass is
   gated off above 1,800km, leaving the fast network at ~2.1:1 against the
   ground — under the 3:1 minimum, in the view where corridors are read.
5. **The camera floor is 140km**, so 3.6MB of already-shipped street data can
   never appear on the canvas.

---

## Inherited constants — strawmen, not decisions

Flagged in the pattern established by the greenfield ruling in
`2026-08-20-core-gameplay-loop-design.md`. Each arrived as a constant from
existing code and has never been argued from what this game needs.

- **Three pace tiers, at 85 and 65 km/h** (`scripts/05-bundle.mjs`). Whether
  three is the right number of tiers, and whether those are the right
  thresholds, has never been asked.
- **Pace opacities .95 / .74 / .56** (`web/app.css`). Copied because they
  existed.
- **Zoom gates at 900 / 1800km.** `MAP-SPEC.md` admits these were "borrowed
  from terrain's existing numbers, not independently validated."
- **The dark casing approach and its colour.**
- **The claim that the pace width ratio is difficulty-calibrated.** It is not:
  `play/balance-check.mjs` reads `data/` and is blind to every constant under
  `web/`. No width constant has ever been balance-checked. The doc asserts a
  gate that does not exist.

`2026-08-21-map-representation-design.md` argues colour-for-type and
weight-for-pace partly from renderer parity with the shipped SVG and partly
from that false calibration claim. **Its conclusion may well be right, but its
reasoning needs re-arguing from first principles** — from the viewing
conditions and from what the game needs — not from what `web/` happens to do.

---

## What is worth keeping

The data, which is expensive and real: 838 cities and 2,160 genuinely routed
edges with true geometry and per-segment realised pace; DEM relief; OSM land
cover; street grids for 397 cities; and a puzzle set measured on 2026-08-21 to
carry a readable decision in 92.9% of cases.

The design discipline in `CARTOGRAPHY.md`: load-bearing versus scenery, never
hue alone, the 3:1 contrast floor, and recording rulings with their cost if
wrong.

The pace tell itself, which measurably carries signal.

Both renderers are prototypes. They taught us what the map has to do. Neither
is the shape v1 should take.

---

## Sequencing

Ordered so each step makes the next decidable, rather than by visible progress.

1. **Fetch real OSM road class.** Everything about colour is blocked on it, and
   it is the largest single missing fact. Its own project: matching OSM ways to
   2,160 routed geometries, cached and incremental against a shared service.
2. **Build the real road network as layer 2 scenery.** Resolves the density
   question without touching the decision space; `web/road-network-proto/`
   already prototypes it.
3. **Fix continuity and contrast at planning zoom.** Makes corridors traceable.
   Acceptance criteria already derived in the representation spec.
4. **Add the orientation layer.** Named settlements, physical labels,
   graticule, borders. Mostly already in `data.json` and drawn by nobody.
5. **Add route numbers and per-leg distances.** The two highest
   realism-per-byte items, and the most directly transferable.
6. **Then** the remaining channels — time, jurisdiction, risk — each needing
   its own model before it can be drawn.

Steps 1–2 and 4–5 are data and content work. Step 3 is the only one that is
purely rendering.

---

## Open questions

- **One renderer or two?** v1 needs one. Which shape it takes — the canvas
  engine matured, the SVG extended, or a fresh build using both as prototypes —
  is undecided and is the largest open question here.
- How many road classes to draw once the data exists.
- Whether the 140km camera floor moves, which decides whether street detail is
  ever reachable.
- Terrain resolution: `DEM_ZOOM=8` gives 195 m/px, roughly 2× under-resolved at
  the camera floor; z9 costs 4× the pixels against a deferred budget where
  `web/terrain/` alone is already 27MB of 31MB.
- What risk exposure is, as a quantity, before it can have a channel.
