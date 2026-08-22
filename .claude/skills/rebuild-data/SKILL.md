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
          07-streets [Overpass]> legacy/web/streets/*.json + manifest.json

      05-bundle (graph+map+puzzles+road-names) ──> legacy/web/data.json
        04-terrain.py       ──> legacy/web/terrain*.webp, terrain-tiles.json
        10-water-raster.py  ──> legacy/web/water*.webp
        11-urban-satellite  ──> legacy/web/urban-*.webp
        08-cartography      ──> legacy/web/cartography.json
        09-real-osm-forests ──> legacy/web/cartography.json

`legacy/web/data.json` is both the fan-in of the Node stages and the input to
every raster stage, so `05-bundle` must run before any of them.

Everything from `05-bundle` down feeds the retired game and canvas-engine
prototype in `legacy/` (see `/README.md`) — kept regenerable for reference,
not part of the core-loop direction. `00`–`03` and `06` (city/graph/puzzle
generation into `data/`) are the direction-agnostic part core-loop's own
route-generation work is expected to build on.

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
existing set's budgets in place. legacy/docs/SPEC.md:226-233 measured doing
that to the pre-driving-hours set as leaving 8.5% of it with the shortest road
winning outright. Verify with [[balance-check]] afterwards.

## Known hazards

- **City indices are positional.** Growing the roster reorders them, which
  silently repoints `legacy/web/streets/manifest.json` at the wrong cities.
  Rebuilding the roster without rebuilding streets is how that happens.
  `npm run doctor` catches it.
- **`legacy/web/cartography.json` has two producers.** `08-cartography` and
  `09-real-osm-forests` both write it in full and neither reads it back, so
  whichever runs last discards the other's output. Unresolved; `npm run doctor`
  warns.
- **External services:** OSRM for `01` and `06`; Overpass for `07`.
  `07-streets` takes roughly 50 minutes against public mirrors.
