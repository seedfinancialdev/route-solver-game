> **Retired 2026-08-29.** This was the playable prototype for the Cannonball
> racing-manager design in
> `docs/superpowers/specs/2026-08-20-design-intent.md` (now superseded) — a
> garage of curated cars, drag-to-reroute planning, and server-authoritative
> route resolution against the real road graph. Superseded by the
> navigation-literacy redesign; see `/README.md` for the current direction.
> Kept here, still buildable, for reference — the routing engine it ran on
> (`scripts/lib/resolve.mjs`, `scripts/lib/road-graph.mjs`) moved forward as
> shared infrastructure rather than retiring with the app built on top of it.
>
> The measurements behind the retirement live in
> `docs/superpowers/specs/2026-08-23-system-coupling-findings.md` and
> `2026-08-23-run-criteria.md`. Short version: of the systems this prototype
> existed to support — fuel, enforcement, traffic, driving hours, car choice —
> only checkpoint selection and ordering ever changed which route won,
> because on a real road network the fastest corridor is also the least
> policed and the best fuelled. The next design stopped asking "which route
> is globally fastest" at all.
>
> Paths below are relative to this file (`legacy/atlas/`).

## What's here

A garage (curated cars, priced builds against a performance-points cap) and
one race — pick checkpoints, choose a departure hour, drag a leg to reroute
it — resolved server-side against the real road graph.

```
index.html          entry point
garage.html          the garage
race.html            the race, map, and result panel
build-geojson.mjs    builds cities.geojson from data/cities.json
build-garage.mjs     builds garage.json from data/cars
build-race.mjs       builds race.json (checkpoint matrix, medal thresholds)
check-style.mjs      lints style.js against the cartography discipline
```

`../scripts/serve-atlas.mjs` serves this directory and the real `POST
/resolve` route (the road graph is 772MB and Node-only, so plan resolution
was always server-authoritative).

## Running it

```sh
npm run atlas:data      # build cities.geojson + garage.json
npm run atlas:garage    # (re)build the garage from data/cars
npm run atlas            # serve at http://localhost:8140, with /resolve
```
