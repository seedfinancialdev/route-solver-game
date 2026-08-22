# Map representation: road type, pace, and what the map is for

2026-08-21. Supersedes `docs/MAP-SPEC.md`'s colour-treatment section, for both
roads and ground. Extends `docs/CARTOGRAPHY.md` rather than replacing it.

This document settles how the map states two different facts about a road
without conflating them, and derives the constraints on doing so from
measurement rather than taste. Every number below was measured on 2026-08-21
against the shipped data. Where a figure is uncertain, it says so.

---

## What this settles

1. The map expresses **three** variables, not two, and they are independent.
2. **Colour is road type. Weight and opacity are pace.** Terrain explains the
   gap between them.
3. Road colour is **evidence, not scenery**, and therefore leaves the theme
   presets and stops responding to time of day.
4. The basemap is the **Natural Physical Atlas** preset. This is a decision,
   and it contradicts `MAP-SPEC.md`'s written instruction — see Rulings.
5. At planning zoom a corridor must be **traceable end to end**. Continuity is
   a hard requirement; the strength of the pace tell is allowed to degrade.

---

## The three variables

**1. Road type.** What a road *is* — motorway, trunk, primary, secondary. An
administrative and engineering fact. Mostly stable along a road's length.
**This data does not currently exist anywhere in the pipeline** (see
Dependencies).

**2. Realised pace.** How fast a stretch *actually drives*. Derived from real
routing time over real distance and bucketed into three tiers at 85 / 65 km/h
by `scripts/05-bundle.mjs`. It varies enormously *within* one road: 93.9% of
roads contain more than one pace tier, and one road splits into 22 runs.

**3. The explanation.** Terrain, urban density and jurisdiction — the reasons a
road of a given type drives at a given pace.

### These are genuinely different variables

Measured: 63,768 routing steps carry **1,094 distinct speeds** in a smooth
distribution with a broad mode at 35–45 km/h. A speed table keyed off road
class would spike at a handful of values. It does not. Pace is realised speed
over real geometry, so type cannot be recovered from it, nor it from type.

### The gap between them is the game

"This is a motorway, and it is drawn slow" is a question whose answer —
mountains, a city, a border into a slower country — is transferable knowledge.
That is pillar 2 (*mastery is a transferable reading skill*) expressed
cartographically. Collapse type and pace into one signal and the question
disappears.

That collapse is what the canvas was doing: three colours named
`roadMotorway` / `roadTrunk` / `roadPrimary` that in fact held pace tiers, so a
slow mountain stretch of a real motorway was drawn — and named in the source —
as a minor road. Type was not merely conflated with pace; it was overwritten by
it. Corrected 2026-08-21; `tests/road-palette.test.mjs` guards the regression.

---

## Channel assignment

| variable | channel | status |
| --- | --- | --- |
| Road type | **hue** | reserved, unspent until class data exists |
| Realised pace | **stroke width + opacity** | shipped, tested |
| Explanation | **terrain relief, borders, urban footprints** | drawn, not yet treated as evidence |

### Why pace keeps the weight channel

Three reasons, none aesthetic:

- The shipped SVG renderer already puts pace on width and opacity
  (`web/app.css:228-230`). Moving it would desync the two renderers on the
  game's core signal — the defect fixed on 2026-08-21.
- The pace-on-width ratio is **calibrated as difficulty**. `CARTOGRAPHY.md`
  classes a width-ratio change as a difficulty change. Moving pace off width is
  a game change, not a style change.
- `CARTOGRAPHY.md`'s **never hue alone** rule exists so the pace tell survives
  colour blindness. Width and opacity satisfy it; hue alone would not.

The rejected alternative was the Google-traffic encoding — width for type,
colour for live speed — whose real merit is that hundreds of millions of people
read it without instruction. It loses on all three points above.

### What we are knowingly doing that no atlas does

In every paper atlas, colour *and* width both encode type: a motorway is
distinctly coloured *and* drawn fat. We are taking width away and giving it to
pace. **"Motorway-coloured, drawn hairline" is a silhouette no atlas has ever
printed.** That is deliberate and it is where the learning lives, but it is an
extension of the convention rather than an adoption of it, and it has not been
tested on a reader who does not already know the rule.

---

## The rule: scenery responds to time of day; evidence never does

Road colour currently lives inside each theme preset, which makes it scenery.
It moves out into one fixed classification palette shared by every preset and
every hour.

This sharpens the existing load-bearing/scenery split in `CARTOGRAPHY.md` into
something testable: **no theme preset may define a road colour.**

Note on current behaviour: `nightFactor` today only swaps the urban layer
between daytime footprints and night lights
(`web/map/cartography-layer.js:213-227`). Land, water, terrain and forest do not
change with the hour. So the rule costs nothing to adopt now; it exists to stop
roads drifting into decoration when the day/night treatment grows.

---

## Palette constraints (measured)

Roads are drawn over their own dark casing (`#1a1d24`), not directly over
terrain, so the binding contrast is road-against-casing.

| candidate | vs casing | |
| --- | --- | --- |
| near-white `#f2efe9` | 14.7:1 | passes |
| amber `#e6b455` | 8.9:1 | passes |
| osm-carto pink `#e892a2` | 7.3:1 | passes |
| current red `#c0392b` | 3.1:1 | passes, no headroom |
| deep blue `#2b4b8f` | 2.0:1 | **fails** |
| dark slate `#2a2f3a` | 1.3:1 | **fails** |

Floor is 3:1, the WCAG minimum for non-text graphical objects, already adopted
by `CARTOGRAPHY.md`.

**Consequences.**

- **A blue motorway is not available on this map.** The conventions that colour
  motorways blue — the UK and German schemes among them — fail against a dark
  casing. The warm hierarchy — red, amber, paler neutrals — is the family that
  survives. Which publisher uses which hue is deliberately not asserted here:
  the palette must be pinned against real atlas references, not recollection.
- The current red has no headroom at 3.1:1, so it is a poor choice for the
  *most* important class. The top of the hierarchy needs a lighter, more
  luminous colour than the one in use.
- **A paper atlas's palette cannot be transcribed.** Michelin's minor roads are
  white because white *is* the page — they recede by dissolving into it. On a
  dark ground a white road is maximum contrast and would read as the most
  important thing on the map. On paper things recede toward the page; here they
  recede by desaturating toward the ground. The ranking must be re-derived, not
  copied.

Ground luminance the road assembly sits on, measured over
`web/terrain-detail.webp` composited per the shipped blend modes: p1 **0.039**,
p50 **0.119**, p99 **0.268**. The casing itself reaches only **1.31:1** against
the darkest ground, so in deep shadow the assembly's outline is weak even
though its core still reads.

---

## Continuity at planning zoom (measured)

### There is something worth reading

Across all 9,310 shipped puzzles, corridors were enumerated by iterative
penalised Dijkstra over minutes, accepted within +20% of optimal and under 65%
shared distance — the method in `2026-08-20-design-intent.md`.

Readability is measured as **tier-mix difference**: each corridor has a
distribution of its length across the three pace tiers, and the metric is the
largest total-variation distance between any two corridors on a route. This is
the right measure because the drawn width *is* the tier mix.

Calibrated against the spec's own two published anchors:

- Konya→Milan, *"the same drive on different asphalt"* → **0.032**
- Bilbao→Gdańsk, *"genuinely different roads"* → **0.100**

So 0.10 is an inherited threshold, not an invented one.

| | |
| --- | --- |
| offer 2+ distinct corridors at +20% | **97.4%** |
| ...with ≥5 km/h speed difference | **88.0%** |
| ...with a visibly different drawn tier mix (≥0.10) | **92.9%** |
| median tier-mix difference | **0.257**, 2.5× the readable anchor |

**Caveats, and they are real.** The enumerator is more permissive than whatever
produced the original table — it reports 2.6% single-corridor routes where the
spec reports roughly 8% — so treat corridor *counts* as optimistic. Bilbao→Gdańsk's
slow 71.8 km/h corridor was not reproduced at any penalty setting. The
tier-mix figure is the robust part: sweeping the finder from permissive to
strict moves the median only 0.257 → 0.221 → 0.193, all comfortably above the
0.10 anchor and 6× the flat one.

**Conclusion: the puzzle set is not the bottleneck.** The difference a player
needs is present, in the data, in the channel the map already draws.

### But it cannot be traced

The renderer gates whole runs by tier: primaries draw only at ≤900km, trunks
only at ≤1800km.

| zoom | corridor length actually drawn | median drawn tier-mix difference | still readable |
| --- | --- | --- | --- |
| ≤900km | 100% | 0.257 | 95.4% |
| 1,200km | **67.2%** | 0.171 | 85.4% |
| >1,800km | **53.0%** | 0.125 | 68.2% |

The *difference between* corridors survives everywhere — 0.171 and 0.125 both
clear the 0.100 anchor. **Continuity does not.** At planning zoom a third of
every corridor is not drawn; at continental zoom nearly half. Because 2,159 of
2,160 roads begin or end with a slow city-exit run, corridors detach from their
cities and break mid-length. A route that is 33% missing cannot be traced,
however well the visible two-thirds is differentiated.

---

## Defects this makes visible

1. **Runs are gated to nothing rather than receding.** The fix is to replace the
   boolean gates (`drawPrimaries`, `drawTrunks`) with continuous width and alpha
   curves that never reach zero. No new visual channel is needed — the alpha
   channel wired for pace on 2026-08-21 already does it, and its ordering is
   already locked by tests.
2. **The casing is gated off above 1,800km.** `if (drawTrunks)` wraps the whole
   casing pass, so at continental zoom the fast network draws at 0.45 alpha
   directly onto hillshade and measures **~2.1:1** against both the darkest and
   brightest ground — below the 3:1 floor, in the exact view where corridors are
   read.
3. **Terrain is treated as scenery.** Once type and pace are separated, terrain
   is the *explanation* for their gap and becomes load-bearing. Its resolution
   (195 m/px, magnified roughly 2× at the 140km camera floor) is then an
   evidence question, not a polish question.

---

## Acceptance criteria

Testable without a browser, by re-running the measurement above:

- **≥95%** of corridor length drawn at every zoom (currently 67.2% / 53.0%).
- Median drawn tier-mix difference **≥0.10** at every zoom; must not regress
  from today's 0.171 at 1,200km or 0.125 above 1,800km.
- Width and alpha ordering tests pass at every zoom (already enforced by
  `tests/road-palette.test.mjs` and `tests/road-width-ordering.test.mjs`).
- Every road class colour clears **3:1** against the casing, and the casing is
  drawn at every zoom.
- No theme preset defines a road colour.

Two things no test can decide, both requiring eyes on `web/map-studio/` at
~1,200km: whether receded hairlines read as an atlas dropping detail or as
mess, and whether motorway-coloured-but-hairline teaches or merely confuses.

---

## Dependencies

**Colour cannot be filled in until real road class exists.** It is absent at
every stage: `data/graph.json` edges carry `{a, b, km, min, geometry, steps}`
with steps as `[metres, seconds]`; `web/data.json` edges carry
`[a, b, km, min, tiers, …geometry]` where `tiers` is realised speed. No OSM
`highway` tag is fetched, stored or bundled. `roadNames` is 2,160 nulls, so the
route-number proxy is unavailable too, and `data/raw/` is empty — both OSRM
caches are cold and the routing cache that built `graph.json` is gone.

Route decided: **fetch real `highway=*` tags via Overpass**, following the
pattern `scripts/09-real-osm-forests.mjs` already establishes, rather than
inferring class from route-number prefixes. Prefix conventions are
country-specific and ambiguous; a map that draws a road as a motorway because
its number starts with the right letter is teaching a heuristic dressed as a
fact, and would be invisible when wrong. This is its own project: matching OSM
ways to 2,160 routed geometries is real work, and it is bulk traffic against a
free shared service, so it must be cached and incremental.

**Until then the honest state is one hue with pace on weight** — colour unspent
rather than guessed. That is what ships today.

---

## What this does not do

- No corridor pre-computation and no per-route highlighting. The map is made
  readable; the reading stays the player's. Highlighting the good corridors
  would delete the skill the game exists to build.
- No change to the routing graph, the puzzle set, or any budget. The 2,160
  curated corridors are untouched, so no re-balancing is implied.
- No change to the shipped SVG renderer.
- Does not settle whether the real OSM road network should be drawn as
  *scenery* beneath the curated graph — `MAP-SPEC.md`'s layer 2. That remains
  the right next project and needs its own spec.

---

## Rulings

**The basemap is the Natural Physical Atlas preset.** — `MAP-SPEC.md` says *"Do
not use osm-carto's default bright cream/green — it clashes with the existing
dark palette"* and specifies `land: #232b35`, `water: #12283a`. What is built is
`land: #5a714d`, `water: #1f6291`. The built version is chosen and MAP-SPEC's
palette section is superseded. — *Why:* the naturalistic ground is what makes
terrain legible as an explanation, and terrain is load-bearing under this
design. — *Cost if wrong:* the shipped SVG game and the canvas remain two
visually unrelated products, and the near-monochrome discipline that made the
SVG readable has to be re-earned on a busier ground.

**Roads do not respond to time of day.** — *Why:* evidence that changes with
lighting is decoration. — *Cost if wrong:* night scenes lose atmosphere the
lighting could otherwise carry.

**Pace stays on width; the Google-traffic encoding is rejected.** — *Why:*
renderer parity, calibrated difficulty, colour-blind survivability. — *Cost if
wrong:* players arrive knowing the Google convention and must learn ours
instead.

**Corridors are not highlighted.** — *Why:* the reading is the skill. — *Cost if
wrong:* the map is harder to learn than it needs to be, and new players bounce
before literacy forms.

---

## Open questions

- How many road classes to draw. OSM offers motorway/trunk/primary/secondary/
  tertiary; an intercity graph probably needs three or four. Undecided.
- The actual palette values, which must be derived against a dark ground rather
  than copied from a paper atlas, and pinned against real atlas references
  rather than recollection.
- Whether jurisdiction earns its own visible channel or is left to be inferred
  from borders plus visible pace. Unmeasured: how much of the pace variation
  country actually explains.
- Whether the 140km camera floor should move, which decides whether the
  3.6MB of already-shipped street data can ever appear on this renderer.
- Terrain resolution. `DEM_ZOOM=8` gives 195 m/px; z9 would give ~98 m/px and
  match screen resolution at the camera floor, at 4× the pixels against a
  deferred budget where `web/terrain/` alone is already 27MB of 31MB.
