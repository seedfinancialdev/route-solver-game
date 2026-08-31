# Design intent: what this game is

Design intent, 2026-08-30. Supersedes `2026-08-20-design-intent.md` in full.

**Scope: intent and pillars, plus the concrete shape needed to size a build
sequence** — data model, round generation, the live loop, scoring, reveal.
Not final numbers; every constant named here is either sourced or explicitly
flagged as a tuning pass, not invented. Where this document and a later one
disagree, this one is wrong or the later one is — say which, in writing, and
fix it here. Same discipline the previous document held itself to.

It supersedes `2026-08-20-design-intent.md`'s "Racing manager married to
GeoGuessr" framing in full: fuel, enforcement, weather-while-driving, car
loadout, city checkpoints, pin-based pre-departure route planning, and the
Plan phase itself. See **What this replaces** below. The measurements that
framing produced — corridor diversity, system coupling — are not wrong, and
are cited here as evidence, not discarded along with the framing they were
measured against.

---

## The pitch

**Navigation and geography literacy, tested directly.**

You are dropped onto a real road network with an objective. The only skill
in the game is inferring, at each junction, which branch leads toward it —
from a tight visibility radius, a locally-styled sign carrying real
destination names and distances, sun-shadow direction, and terrain. Every
wrong inference costs real distance you have to walk back. At the objective,
one real photograph anchors a final guess at where in the world you've been
the whole time.

Not the driving. The car drives itself between decisions; you are the
navigator, never the driver.

---

## Pillars

Load-bearing. Changing one changes what the game is.

### 1. Reality is still the design authority

Unchanged from the previous document. Sign text, destinations, distances,
road class, sun angle, country speed limits, driving side, sign style —
sourced, never invented. Hold any system to "where did this number come
from?"

### 2. Every decision is local

New, and the reason this design survives where the last one's routing layer
didn't. `2026-08-23-system-coupling-findings.md` measured that seven of nine
non-time systems were structurally inert, because global optimization on a
real road network always finds the same winner — the fastest corridor is
also the least policed and the best fuelled ("everything good is in the same
place"). This game never asks "what's globally fastest." It asks "what can
you infer from what's in front of you, right now, with only what you've been
shown." A second browser tab cannot answer that, because it does not know
where the player is — and neither does the player, which is exactly the
point.

### 3. Mastery is a transferable reading skill

Floor: judging a decision's weight — how far to the next decision point,
whether the choice is reversible. Learnable in a handful of rounds. Ceiling:
road and country literacy — recognizing a jurisdiction's sign style, colors,
road markings, vegetation, and terrain before being told. Takes dozens of
rounds. The ceiling is "can read any road network," not "has memorized
Europe" — the same corollary the previous document made about GeoGuessr,
now literal rather than metaphorical.

### 4. No randomness, every consequence earned

Unchanged. Wrong-turn cost is deterministic: how far to the next junction,
whether the road permits a U-turn or locks you in until the next exit. Round
generation is deterministic from a seed. No dice anywhere in the core game.

### 5. The map is the evidence surface

Sharper than before. Within the fog-of-war radius is the only evidence that
exists at decision time, full stop. The previous pillar was fighting an
inherited SVG engine's weaknesses; here it is the literal, unmediated design.

### 6. Region is data, never code

Unchanged, now covering more region attributes than before: speed limits
(already had this), plus driving side, sign style, and road-numbering
convention. Every one a curated, sourced table — never invented, never
hardcoded into logic.

---

## What this replaces

| Rejected | Why |
| --- | --- |
| Risk exposure as a unified currency (fuel, enforcement, weather-while-driving) | Measured to be structurally inert on a real road network — `2026-08-23-system-coupling-findings.md`. The new design doesn't need it to reverse a ranking, because it never asks which route is globally fastest. |
| Car loadout | No driving, no car choice. The car is not a decision surface in this design. |
| City checkpoints, pin-based pre-departure planning | The whole Plan phase. Route "planning" isn't a separate mode from execution — every decision happens live, at a junction, on local evidence only. |
| The Plan → Execute → Debrief loop as previously specified | Replaced by drop → objective → junction decisions → panorama → guess → reveal. |
| `atlas/`, the prototype built for the above | Retired to `legacy/atlas/`, 2026-08-29. See `legacy/atlas/README.md` for what it was and the measurements behind the retirement. |

**Retained**, on its own merits: the junction-level road graph and its
routing engine (`data/road-graph/`, `scripts/lib/road-graph.mjs` — confirmed,
by direct inspection, to have zero dependency on anything atlas-specific);
`countrySpeed`'s sourced-data discipline, now extended with more region
attributes; `core-loop`'s step/interrupt/replay architecture; the
bot-drivable balance methodology; deterministic daily conditions, once the
v2 meta-loop is built; never relying on a single visual channel for
load-bearing information.

---

## The player

No fiction, no character — unchanged. Tone comes from the map, the clock,
and the real photograph at the end.

---

## The loop

Drop, with an objective stated plainly: reach a town with a railway station,
cross into the neighboring country, reach a motorway, reach the coast.

Junction by junction, the car drives itself between decisions. At each one:
branch geometry and class, a locally-styled sign built from real OSM
destination/ref data, sun-shadow direction, and whatever terrain sits inside
a tight fog-of-war radius (roughly 300m). Tap a branch. Between junctions,
travel compresses — real distance covered in a few real seconds, still
carrying passive evidence: a river crossed, forest giving way to farmland, a
change in elevation.

A wrong branch costs real distance: a cheap U-turn on an ordinary road, or a
ride to the next exit on a motorway or dual carriageway you cannot leave.

The round ends at the objective. One real panorama — a static photograph, no
movement, no look-around — anchors a guess: a pin on an unlabeled world map
(coastlines, borders, rivers, terrain shading; no place names, no roads),
using everything gathered along the way plus the photograph.

Then the reveal: the camera pulls back from the driven line to the labeled
map, the player's actual route and the optimal route both drawn, the exact
junction where they diverged marked. The guess pin and the truth, a line
between them. Two or three sentences of teaching — principles, never facts
specific to one road.

Score is simulated elapsed time — distance over posted speed limit, plus
hesitation, plus backtrack cost — scaled by a bonus for guess accuracy. Exact
tiers are a tuning pass against real round data, not invented here.

---

## Content model and tiers

One deeply modeled network, varied endpoints and objectives — the same
content model as the previous document, still true here: variety comes from
where you're dropped and what you're asked to reach, not from procedurally
inventing new terrain. You meet the same roads many times; literacy
accumulates.

**v1 is single-round, single-player.** Prove the core loop is worth playing
before building anything durable around it. The daily-seed / ghost-routes /
passport meta-loop from the original brainstorm is real and wanted, but
explicitly v2 — see **Open questions**.

---

## Data model

What v1 needs that does not exist today:

1. **A destination/ref/lane sidecar** on the road graph. `14-road-graph.py`'s
   tag extraction currently reads only `highway`/`access`/`maxspeed`/
   `oneway`/`toll`. Add `destination`, `destination:ref`, `ref`, `name`,
   `lanes`, stored separately from the flat binary arrays so the compact
   format doesn't bloat. This is what the sign generator reads.
2. **Country attributes**, extending `country-facts.mjs`: driving side, sign
   style, road-numbering convention. Same curated-table discipline
   `countrySpeed` already follows.
3. **A panorama coverage index** — which candidate points have confirmed
   Mapillary coverage, built once against Mapillary's coverage API, cached.
   Makes destination-first generation cheap: filter before pathfinding, not
   after.
4. **An unlabeled basemap**, derived from the Natural Earth polygons already
   in `data/raw/` — one variant for the drive view (labels off, roads on), a
   further-stripped variant for the guess map (no roads either — that screen
   tests "where on Earth," not "which road").

What's already real and needs no rebuilding: `data/road-graph/`'s
junction-level topology (30,163,008 nodes, 37,881,808 edges, across 20
countries — real OSM intersections, not collapsed city-to-city edges), and
`scripts/lib/road-graph.mjs`'s routing primitives (`route`, `routeTimed`,
`corridors`, `junctionNode`).

---

## Round generation

Destination-first, one pipeline shared across objective types. Each type
supplies a candidate-destination filter; all share one panorama-anchor rule
(coverage confirmed near the candidate point):

| objective | candidate filter |
| --- | --- |
| Reach a town with a railway station | station-tagged node, coverage nearby |
| Reach the coast | road node near the coastline polygon, coverage nearby |
| Cross into the neighboring country | road node crossing a border polygon, coverage nearby |
| Get onto a motorway | node where road class transitions to motorway, coverage nearby |

From a chosen destination, walk backward through the graph's adjacency to a
drop point 30-60km out by road, counting real decision points (junctions
with out-degree ≥3 — the same criterion `junctionNode()` already uses) until
the walk lands on 8-12, matching the 2-4 minute round length the original
brainstorm called for.

v1 rounds are hand-picked and editorial, the same precedent the old career
races set — not the automated generator at scale, which is phase 6 of the
build sequence below.

---

## The live decision loop

Built on `core-loop`'s existing step/interrupt/replay shape, not a new
engine:

- A **leg** is compressed travel between junctions. `{ticks}` gets real
  meaning: simulated seconds from distance over posted speed limit.
  Compression (real kilometers covered in a few real seconds) is a pacing
  layer on top; the score is simulated elapsed time, never wall-clock.
- Passing evidence between junctions (a river, a land-use change, an
  elevation change) comes from a spatial query against land-use polygons and
  terrain data already in the pipeline — no new geometry engine.
- An **interrupt** composes the junction: branch geometry and class from the
  graph, a sign panel from the new sidecar styled per the country's
  conventions, real sun-shadow angle from solar geometry (latitude,
  longitude, the round's timestamp — a formula, not new data), and the
  fog-of-war radius clipping the map.
- **resolve()** charges backtrack cost from the graph's own class/oneway
  flags — cheap U-turn on an ordinary road, ride-to-next-exit on a motorway
  or dual carriageway.
- Every choice logs `{legIndex, ticksIntoLeg, module, choice}`, exactly as
  `core-loop` already does. That log is the player's route as an edge
  sequence — what divergence detection needs at reveal, and what a v2 ghost
  route replays.

---

## Scoring and reveal

Score is simulated elapsed time (distance over posted limit, plus
hesitation, plus backtrack cost), scaled by a bonus for guess accuracy —
country-level worth something, region-level more, near-exact worth full
value. Exact tiers are a tuning pass against real round data; the shape is
decided here, the constants are not invented in advance, same discipline the
previous document held its own numbers to.

The reveal draws the player's actual route and the optimal route (both edge
sequences, both already producible from `road-graph.mjs`) on the now-labeled
map, marks the exact junction where they diverged, shows the guess pin
against the truth with a line between them, and closes with 2-3 sentences of
teaching copy. That copy must teach principles, never facts specific to one
road — "yellow center lines are Finland" travels, "the E8 goes to Kalajoki"
doesn't. Every line is auditable against that test, the same discipline the
previous document's debrief section demanded.

---

## Balance methodology

Inherited unchanged: `core-loop`'s bot-drivability requirement and `play/`'s
bot-sweep technique become the new balance gate. A bot that always reads the
evidence correctly, measured against one that never does, should show a
real, measured time gap on every shipped round — the new game's version of
the old 20% bar, verified the same way the old game verified the shortest
road still loses.

---

## Build sequence

1. **Data foundations.** The sidecar; a small hand-picked panorama-coverage
   candidate set, not the automated generator yet.
2. **Prove the map reads.** Label-stripped style, fog-of-war radius, tested
   against: *at a junction, can a person identify the branches and form a
   hypothesis about which leads toward the objective, and why?* Run with
   real people before building anything downstream.
3. **The junction-decision loop, minimal.** Real decision points, real
   backtrack cost, placeholder signage — prove "fewest wrong turns" is worth
   playing before spending on sign rendering.
4. **Real signs**, once the sidecar and country sign-style data exist.
5. **Close the loop end to end** on one hand-picked round: panorama,
   guess-map, scoring, reveal.
6. **Expand to all four v1 objective types**, each with its own
   candidate-destination finder.
7. **Only then**: automated destination-first generation at scale, daily
   seed, v2 meta-loop.

---

## Open questions

Real gaps, not oversights.

- Exact scoring tiers and the guess-accuracy bonus curve — a tuning pass
  against real round data, not invented here.
- The v2 meta-loop's shape in detail: daily seed mechanics, ghost-route
  replay/display, the passport's exact progression. Real and wanted,
  deliberately deferred past v1.
- Whether Mapillary's coverage, measured against the four v1 objective types
  across real candidate regions, is dense enough to sustain a launch region,
  or whether Street View becomes necessary sooner than planned. Mapillary
  was chosen for v1 specifically because that answer isn't known yet and
  Mapillary's failure mode (a thinner candidate pool) is cheap while it's
  being found out, where a metered API's failure mode is a bill.
- Which region(s) v1 actually ships in. Europe is where the data is
  cheapest (unchanged from the previous document's region-is-data
  reasoning), but the exact launch set of candidate destinations per
  objective type is not chosen here.
- Sign-style and driving-side data sourcing plan, by country — the same
  shape of work `countrySpeed` already proved out, not yet executed for
  these new fields.
