# Map spec: terrain + real cartography + gameplay overlay

Not shipped. This is the spec for the active direction, written after a full
session of prototyping, mistakes, and real measurement — kept separately from
`docs/SPEC.md` so it can be handed to whoever builds it without needing this
session's full history. Everything below is either a real, measured fact or
explicitly flagged as an open question. Nothing here is invented.

## The goal, precisely

Three layers, in this order, bottom to top:

1. **Terrain relief** — already built, already good, keep as-is.
2. **Real cartographic detail** — forest, farmland, water, and a real road
   network, styled to feel alive, not decorative.
3. **The gameplay overlay** — the curated cities/edges/dots/HUD the actual
   race runs on. Untouched by any of this.

Reference point: this combination (real cartography + hillshade relief) is a
known, proven map style — OpenTopoMap is the open-source example. This is not
a new category to invent. It's a known-good one, built with this game's own
palette instead of theirs.

## Layer 1: terrain relief (existing, working, do not touch)

- Source: AWS Terrain Tiles — a compilation of SRTM, USGS 3DEP, GMTED2010,
  ETOPO1, and national datasets.
- Built by `scripts/04-terrain.py`, three resolution tiers:
  - **Overview**: 2400×2349px, ~1.8 km/px, always loaded.
  - **Detail**: 6000×5873px, ~705 m/px, loads once, fades in over the
    overview.
  - **Fine tiles**: a 6×6 grid over the full map
    (`view = {x:-2344.95, y:-2230.35, w:4232, h:4142.65}`, each tile
    ~705.3 × 690.4 km), rendered at ~195–353 m/px, only the 2–3 tiles under
    the current viewport ever fetched.
- This is the reveal-by-zoom pattern every new layer below should copy
  exactly — it's already proven, twice.

## Layer 2: real cartography — the part that needs building

### 2a. Roads (prototyped, not shipped)

- Source: OpenStreetMap, via the Overpass API — reuse the mirror-rotating,
  disk-cached client already built for street-level detail
  (`scripts/lib/overpass.mjs`), same five public mirrors, same retry logic.
- Tags tested: `highway=motorway|trunk|primary`. Not yet tested:
  `secondary|tertiary` — real open question below.
- **Real measured volume**: Czechia alone, 3 tiers, 74,454 ways / 71 MB raw
  JSON from Overpass. After Douglas-Peucker simplification (reuse
  `scripts/lib/simplify.mjs`, tolerances 0.35/0.2/0.12 km per tier, coarsest
  for the tier meant to stay visible at the widest zoom) and delta-encoding,
  ~6 MB.
- Classification hierarchy drives reveal-by-zoom (below): motorway always
  visible, trunk/primary revealed as the camera gets closer.

### 2b. Land use — forest, farmland, water (prototyped, not shipped)

- Source: same Overpass infrastructure. Tags: `natural=wood`,
  `landuse=forest`, `natural=water`, `landuse=farmland`, `landuse=meadow`.
  Not yet tried, present in small numbers in the test pull, worth including
  for completeness: `natural=wetland`, `natural=grassland`, `natural=heath`,
  `natural=scrub`.
- **Real measured volume**: a ~100×110 km box around Prague returned 98,792
  polygons / 252 MB raw JSON. Farmland dominates numerically — 70,905 of
  98,790 drawn, ~72%.
- **Real, load-bearing finding**: individual farmland/meadow parcels are
  frequently smaller than one pixel at country-view resolution
  (~195–350 m/px). Drawing them at native resolution leaves most of the
  farmland invisible. Fix: render the fill layer at 2–3x supersampling, then
  downsample with Lanczos before compositing. Skip this and the data is
  correct but the result looks empty.

### 2c. Sources considered and rejected

- **Geofabrik regional extracts** (`.osm.pbf` / `.shp.zip`, full-country
  bulk downloads): real measured sizes — Czech Republic alone is 944 MB
  (`.pbf`) or 1.49 GB (`.shp.zip`). Rejected: bundles everything OSM has
  (buildings, POIs, full attribute sets), not just the tags needed, and
  doesn't beat a targeted Overpass query on size.
- **Mapnik/PostGIS full cartographic rendering** (replicating
  openstreetmap.org's own osm-carto stylesheet pixel-for-pixel): not
  pursued. Neither Mapnik nor PostGIS was available in the environment this
  was prototyped in. osm-carto represents years of dedicated cartographic
  engineering (land-use rendering, road casing, label collision avoidance)
  — reproducing it isn't a good use of time when a targeted vector-polygon
  approach gets real data richness without needing someone else's full
  stylesheet.

## Color treatment — deliberate, not default

Do not use osm-carto's default bright cream/green — it clashes with the
existing dark palette. Reuse and extend the game's own CSS custom properties
(`--water: #12283a`, `--urban: #a2895c`, `--land: #232b35`). Values reached
through real iteration, offered as a first pass, not final:

- **Forest**: `rgba(18, 52, 32, 0.76)` — deep, desaturated, light-absorbing,
  not cheerful.
- **Farmland/meadow**: `rgba(98, 82, 44, 0.57)` — a muted warm khaki,
  related to but distinct from the existing urban tan.
- **Water**: reuse `--water` exactly (`#12283a`) — the same color lakes and
  rivers already use. No new color needed.
- Roads: motorway reuses `--road` (`#c0392b`), trunk uses `--amber`
  (`#e6b455`), primary a neutral gray-blue (`#96a0ab` in testing).

These numbers looked right composited directly onto real terrain at native
resolution, judged in isolation. They have not been judged live, in motion,
next to the gameplay overlay, across multiple regions. That's real remaining
work, not a rubber stamp.

## LOD / reveal-by-zoom

Extend the exact pattern terrain tiles and street detail already use —
nothing conceptually new, just applied to two more layers:

| zoom (camera span) | shown |
| --- | --- |
| any | motorway spine, terrain overview |
| ≤ 850 km | terrain fine tiles, trunk roads, land use begins fading in |
| ≤ 200 km | primary roads, land use at full strength |
| ≤ 14 km | existing per-city street data (900 m radius, already shipped) takes over |
| ≤ 3 km | pit-stop frame — street data should dominate; land use and terrain are backdrop only |

**These thresholds are borrowed from terrain's existing numbers, not
independently validated.** Real tuning — does trunk actually need to wait
until 850 km, does land use read right fading in at that point — requires
watching it live, panning, at real speed, not guessing from first
principles.

## Mistakes already made this session — read before building

This is the expensive part, worth preserving exactly because it cost real
time to learn:

1. **Never bake a new layer directly into the same raster pixels as an
   existing one with its own opacity logic.** Land use was baked directly
   into the terrain tile's pixels, so it inherited terrain's own opacity
   fade curve (tuned for hillshade legibility, ~0.56 at common zoom levels)
   — muting the land-use colors for reasons that had nothing to do with how
   they were designed. Land use needs its own image layer and its own
   independent opacity/fade curve, composited as a separate `<image>`, never
   merged into terrain's bitmap.
2. **Never render one DOM element per real-world feature.** The road-network
   prototype created one SVG `<path>` per road — up to 74,454 elements for a
   single tile. This alone caused a measured, severe interactive slowdown.
   Fix: one `<path>` per *tier* (motorway/trunk/primary), multiple `M...L`
   subpaths joined into a single `d` attribute — same visual result, three
   DOM nodes instead of tens of thousands.
3. **A tier costs real paint time just by existing, even at `opacity: 0`.**
   Don't create a tier's DOM element until the camera has actually reached
   the zoom where it's shown. Use `display: none` (not `opacity: 0`) for a
   built tier that's currently out of zoom range — `display:none` skips
   paint entirely, `opacity:0` doesn't.
4. **Building one tier's full geometry in a single synchronous call is a
   real ~900 ms freeze the instant it lands**, even after fixing #2 and #3.
   Split the same geometry across several `<path>` elements, one appended
   per animation frame instead of all at once (~1,500 ways/frame in
   testing) — same total work, spread over frames instead of blocking one.
5. **Never ship partial/patchy data coverage into a live, playable build.**
   A test pull covering a small box creates a hard-edged rectangle where
   real data stops and old terrain resumes. Encountered on an unrelated
   route, far from the tested area, this reads as a rendering bug, not an
   incomplete map — because functionally, it is exactly that. Any layer
   shipped live must have full, seamless coverage of whatever area it
   claims to cover. No test patches in a build someone is actually playing.
6. **Evaluate new visual layers in an isolated preview, never wired into the
   live/played branch, until they're actually complete.** A static
   screenshot is also a poor way to judge a map style — no panning, no
   motion, not next to the real HUD. The right middle ground: a standalone
   interactive preview, not the game's own data files, iterated on freely
   without risk of a half-finished experiment surprising someone mid-race.

## Recommended real pipeline

Extend the existing "generate once at build time, commit the static output,
zero runtime network calls" pattern — the same architecture every other data
layer in this project already uses:

1. New build script (parallel to `scripts/07-streets.mjs`), reusing
   `scripts/lib/overpass.mjs`'s mirror rotation and disk caching.
2. Pull per country, staged and resumable — never one giant blocking query.
   (Full-continent volume was never measured directly; scaling from the
   one-region numbers above, tens of GB of raw intake across all 36
   countries is plausible. That needs staging, not one sitting.)
3. Tile the results onto the same 6×6 grid terrain already uses, or
   reconsider whether a finer grid is right for denser layers — real open
   question, not decided.
4. Land use renders to its own tile set, own opacity curve, independent of
   terrain.
5. Roads render consolidated (one path per tier per tile) from the start,
   chunked-build from the start — don't relearn these lessons a second time.
6. Nothing ships into the live game until a full region has complete,
   seamless coverage and has been reviewed live, in motion — not as a
   screenshot.

## What's genuinely still open

- Full-continent data volume — never measured, only extrapolated.
- Whether 850 km / 200 km are the right reveal thresholds — borrowed from
  terrain, not independently tuned.
- Whether the color values above hold up in motion, across regions other
  than Czechia (different real land-cover character — coastal, alpine,
  Mediterranean — hasn't been tested at all).
- Whether a 6×6 tile grid is fine-grained enough for land use specifically,
  given how much denser it is than terrain elevation data.

Treat those four as the first real questions to answer, not settled facts.
