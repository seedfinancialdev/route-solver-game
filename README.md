# Route

A daily route-budgeting puzzle. You are shown a sparse map — country outlines
and city dots, nothing else — and a budget in kilometres. From your current
city a handful of neighbours are selectable. Pick one, pay the real road
distance, repeat. Land on the target with kilometres to spare.

The core loop is estimation, not recall. You can see which cities are
available; what you can't see is what's between them. A hop across the Po
Valley costs roughly its straight-line distance. A hop over the Alps costs 1.5×
and takes twice as long. Reading that from a blank map is the skill.

When the route is locked, the terrain appears along with the real distance and
travel time for every hop you took, and your route is drawn against the optimal
one.

## What's here

```
scripts/     the build pipeline. Runs once; the game makes no routing calls.
play/        the terminal playtest and the player models used to tune the budget
web/         the game. Static files, no framework, no build step
docs/SPEC.md the one-page spec
data/        the generated artefacts
```

## Running it

```sh
npm install
npm run play                  # terminal playtest — today's puzzle
npm run play -- --day 12      # a specific day
npm run play -- --from Porto --to Krakow
npm run calibrate             # the budget-multiplier sweep
npm run serve                 # then open http://localhost:8137
```

Rebuilding the data (needs an OSRM server; see below):

```sh
npm run data:cities && npm run data:graph && npm run data:puzzles && npm run data:map
```

## What the phases turned up

**Phase 0 — the data spike.** 185 cities, 509 edges, one connected component.
Two findings changed the shape of the thing:

- *Sea crossings need no hand-curation.* OSRM marks ferry legs with
  `mode: "ferry"`, which separates the Messina crossing (6.5 km afloat) from the
  Øresund bridge (0 km) exactly. Everything below 3 km afloat is a Danube river
  ferry with a bridge beside it and costs what a bridge costs; everything above
  is maritime. That one signal drops Sicily, Sardinia, Crete and the Balearics
  on its own.
- *Britain, Ireland and the far north are out of the first pass.* Every route
  onto the islands runs through a ferry or the Chunnel, and a sea hop is a cost
  no map can show the player. Finland's only land link avoiding Russia is the
  Tornio corridor, longer than the 420 km hop cap. Both return with world mode.

**Phase 1 — the go/no-go gate.** 874 of 11,224 candidate pairs punish the naive
"hop toward the target" move by 15% or more. The bar was 200. Comfortably a go.

**Phase 2 — the playtest.** The multiplier landed at **1.15**, below the brief's
1.2–1.3 guess. At 1.25 the naive player wins 43% of the time, which means the
puzzle has stopped asking anything. On the 278 shipped puzzles at 1.15:

| player | wins |
| --- | --- |
| naive — always hop toward the target | 6 of 278 |
| a plausible human — three hops of lookahead, misjudges distances | 62% |
| exact planning on straight-line distances | 276 of 278 |

The number came from simulation (`npm run calibrate`), not from thirty rounds
of human play — that part is still worth doing, and `npm run play` is how.
The simulated player is `humanish` in `play/bots.mjs`; if you disagree with the
budget, disagree with that bot first.

## The open questions, answered

1. **Faint distant cities, not strict one-hop visibility.** A player restricted
   to one hop of sight is the `estimator` bot: it wins 35% and busts by walking
   into dead ends it had no way to foresee. With the corridor visible the same
   player wins 62%. Faint visibility is the difference between a puzzle and a
   trap.
2. **No backtracking.** Visited cities aren't selectable. Irreversibility is
   where the tension lives.
3. **A bust doesn't end the round.** The gauge goes red and negative and you
   keep going until you arrive, scoring the overspend. Hard-failing at the
   moment of overspend hides how close you were, and the near miss is what
   brings a player back. Dead ends are the only DNF, and they're rare — 14 in
   1,112 simulated runs.

## Data and routing

- Cities: [GeoNames](https://www.geonames.org/) `cities15000` (CC BY 4.0).
- Boundaries and shaded relief: [Natural Earth](https://www.naturalearthdata.com/)
  (public domain).
- Road distances and durations: OSRM over OpenStreetMap data
  (ODbL — © OpenStreetMap contributors).

`scripts/lib/osrm.mjs` defaults to the public OSRM demo server, which is fine
for a one-off build of ~600 requests but is explicitly not for production use.
Point it at your own instance with `OSRM_HOST=http://localhost:5000`. Responses
are cached under `data/raw/osrm-cache/`, so a rebuild costs nothing.

## Deferred

World mode, time budgets instead of distance, fog of war on the city list,
streaks and accounts. Nothing here needs a backend.
