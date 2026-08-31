# Route

**Navigation and geography literacy, tested directly.** You are dropped onto
a real road network with an objective, and the only skill in the game is
inferring, at each junction, which branch leads toward it — from a tight
visibility radius, a locally-styled sign carrying real destination names and
distances, sun-shadow direction, and terrain. Not the driving: the car drives
itself between decisions, you are the navigator. Full design:
[`docs/superpowers/specs/2026-08-30-design-intent.md`](docs/superpowers/specs/2026-08-30-design-intent.md)
— the authoritative spec, and every later document is audited against it.

That document supersedes `2026-08-20-design-intent.md`'s "Racing manager
married to GeoGuessr" framing — departure timing, enforcement geography,
fuel, weather, car loadout, city checkpoints — in full. That framing is
explicitly rejected in the new document's "What this replaces", kept only so
the rejected ideas don't come back by accident. It had itself already
superseded the "remote orchestrator directing an AI driver through a War
Room" framing from
[`2026-08-20-core-gameplay-loop-design.md`](docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md).
Three framings, two resets — see **Why legacy was retired** below for the
first and `legacy/atlas/README.md` for the second.

This replaces the previous shipped game — a daily driving-hours route puzzle
— and a never-shipped canvas map engine that was being built as its
replacement. Both are retired under `legacy/`: still buildable, playable, and
worth reusing pieces of, but not the direction anything here is building
toward. `atlas/` — the playable prototype for the now-superseded racing-
manager framing — joined them on 2026-08-29. See `legacy/README.md` and
`legacy/atlas/README.md`.

## Where things actually are

```
core-loop/    a Slice-1 architecture proof: a pure step function, module
              registration, bot-drivability, deterministic replay — proven
              against a throwaway, invented module with no game-design
              meaning. Its module is explicitly disposable, but the
              step/interrupt/replay shape is exactly the new design's live
              decision loop — see design-intent.md, "The live decision loop".
data/         real European cities, roads, and driving-hours-aware routing —
              generated once by scripts/, reused by legacy/atlas/, core-loop/,
              and (still) by legacy/. Direction-agnostic; nothing here changes
              with either reset. `data/road-graph/` in particular is already
              junction-level (real OSM intersections, not collapsed
              city-to-city edges) — the substrate the new design needs, and
              still missing the destination/ref/lane sidecar design-intent.md
              calls for.
scripts/      the data-generation pipeline. 00-03, 05, 07, 09 build data/;
              16 builds data/road-graph/ specifically. scripts/lib/
              (road-graph.mjs, country-facts.mjs) is the reusable routing
              engine and region data, kept live here regardless of which app
              calls it — confirmed, by direct inspection, to have zero
              dependency on anything atlas-specific. The race-format gates
              and the atlas-specific parts of the routing layer (resolve.mjs
              among them — it turned out to be built entirely around cars,
              traffic and incidents, not general routing) retired to
              legacy/scripts/ alongside the app they served.
play/         terminal playtest, bot player models, and the puzzle-balance
              tooling — built for the legacy game's specific rules. The
              measurement technique (simulate a bot, sweep, verify the trap
              holds) is the new design's balance methodology too — see
              design-intent.md, "Balance methodology".
legacy/       the previous shipped game, the canvas engine prototype that
              preceded core-loop, and (as of 2026-08-29) the atlas racing-
              manager prototype. Three retired things, three separate
              retirement notes. Retired, not deleted — still builds and
              plays. See legacy/README.md and legacy/atlas/README.md.
docs/superpowers/  design specs and plans. Start at
              specs/2026-08-30-design-intent.md, the current authoritative
              spec. specs/2026-08-20-design-intent.md is superseded but kept
              for its own rejected-ideas record. specs/2026-08-23-run-
              criteria.md and specs/2026-08-23-system-coupling-findings.md
              measured which systems actually changed a race's outcome under
              the old framing; that evidence carries forward into the new
              design's own reasoning even though the framing it was measured
              against didn't.
```

## What's built, and what the design calls for next

Nothing is currently playable at the repo root. `atlas/`, the previous
playable slice, retired to `legacy/atlas/` on 2026-08-29 — see
`legacy/atlas/README.md` for what it was and why.

`2026-08-30-design-intent.md`'s build sequence starts from data foundations
(a destination/ref/lane sidecar on the road graph, a small hand-picked
panorama-coverage candidate set) and a working "blind" evidence surface
(label-stripped map, fog-of-war radius, tested with real people) before any
of the live decision loop gets built — see its "Build sequence" section for
the full seven steps. None of it has started yet.

Confirmed reusable, per a survey done as part of the retirement:
`data/road-graph/`'s junction-level topology and `scripts/lib/road-graph.mjs`'s
routing primitives (`route`, `routeTimed`, `corridors`, `junctionNode`),
`core-loop/`'s step/interrupt/replay architecture, and `country-facts.mjs`'s
sourced per-country speed data. Confirmed net-new: any street-level imagery
integration, procedural sign rendering, a fog-of-war visibility mechanic, an
unlabeled basemap, and the destination/ref/lane/sign-style/driving-side data
the pipeline doesn't produce yet.

## Running things today

```sh
npm install
npm test                 # core-loop and data-pipeline tests
npm run data:cities && npm run data:graph   # rebuild the shared data/ pipeline
npm run osm:build         # rebuild data/road-graph/ specifically
```

`npm run core-loop:play -- --bot` still runs the Slice-1 proof end to end,
human or bot. `npm run doctor` checks the `data/` pipeline.

**Retired prototypes, still runnable:** `npm run serve` / `npm run perf` /
`npm run balance` / `npm run play` / `npm run calibrate` target the original
shipped game in `legacy/web/` (see `legacy/README.md`). `npm run atlas` /
`npm run atlas:data` / `npm run atlas:garage` and the `runs:*` / `fuel:*` /
`enforce:*` / `traffic:*` / `order:*` / `vehicle:gate` / `garage` gate
scripts now target `legacy/atlas/` and `legacy/scripts/` (see
`legacy/atlas/README.md`); `npm run test:legacy` runs both retired
prototypes' test suites.

## What's next

Per `2026-08-30-design-intent.md`'s build sequence:

1. **Data foundations.** The destination/ref/lane sidecar on the road graph;
   a small hand-picked panorama-coverage candidate set.
2. **Prove the map reads.** Label-stripped style, fog-of-war radius, tested
   with real people before anything downstream gets built.
3. **The junction-decision loop, minimal.** Real decisions, real backtrack
   cost, placeholder signage.
4. **Real signs**, once the sidecar and country sign-style data exist.
5. **Close the loop end to end** on one hand-picked round — panorama,
   guess-map, scoring, reveal.
6. **Expand to all four v1 objective types** (station, coast, border
   crossing, motorway), each with its own candidate-destination finder.
7. **Only then**: automated destination-first generation at scale, daily
   seed, the v2 meta-loop.

None of it has started yet — see the design doc's "Open questions" for what's
still genuinely undecided (scoring tiers, the meta-loop's exact shape,
Mapillary coverage adequacy, launch region).

## Why legacy was retired

Both `legacy/` occupants were themselves the *previous* answer to "what is
this game" — a Cannonball-flavored driving-hours puzzle, then a from-scratch
visual rendering push toward replacing its map — and neither one is the
direction design-intent.md sets. Leaving them live in `web/` and
`docs/SPEC.md` at the repo root, next to a brand new redesign, was making it
look like three different games were all in progress at once, because they
were. This reset doesn't change what's buildable — everything in `legacy/`
still runs — it just stops the repo's top level from claiming to be three
things it isn't anymore.
