# Route

A daily route puzzle. You are given a sparse map — country outlines, city dots,
and the roads leading out of wherever you are standing — and a budget of
**driving hours**. Pick a neighbouring city, pay the hours that road takes,
repeat. Reach the target with hours to spare.

The core loop is judgement, not measurement. You can see exactly how long each
road is. What you cannot see is how fast it runs, and across this map **the
shortest route is the fastest route only 27% of the time**. A 250 km motorway
beats a 210 km road over a pass, every time — and the road's own shape, drawn as
it actually runs, is the tell.

Every time you commit, the game says what it cost: *3h09 for 249 km · 79 km/h ·
ordinary going*. The map shows terrain, country names and the roads out of your current city from
the first move — none of it gives the game away, because knowing a mountain range
is there says nothing about which of the several roads through it is quick.

When the route is locked, both routes drive it again side by side at their real
paces, so you watch the fast one pull away exactly where it happened. Then the
numbers, and your route drawn against the fastest way and against the short way
you were tempted into.

## What's here

```
scripts/     the build pipeline. Runs once; the game makes no routing calls.
play/        the terminal playtest and the player models used to tune the budget
web/         the game. Static files, no framework, no build step
docs/SPEC.md the one-page spec
data/        the generated artefacts
```

## Running it

Pan and zoom the map with drag and scroll (pinch on touch); `0` or double-click
resets the view.

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

**Phase 1 — the go/no-go gate.** Comfortably a go: thousands of pairs punish the
naive "hop toward the target" move. The bar was 200.

**Phase 2 — the playtest, and the finding that reshaped the game.** A distance
budget was built, calibrated to 1.15× optimal, and played. It was too easy, in a
specific and fatal way: European road distance is close to Euclidean, so perfect
straight-line planning finds the distance-optimal route at a median cost of
**1.004× optimal**. Across 8,538 candidate pairs there were exactly **20** where
straight-line reasoning was even 10% off. The player was holding a ruler, not
making a decision, and no amount of puzzle selection could change that — the
ceiling was structural.

Time behaves completely differently, because speed is not Euclidean. A motorway
across the North German Plain runs at 90+ km/h; an Alpine pass or a Balkan
two-lane runs at 45. Same measurement, different currency:

| the player pays in | straight-line planning costs | pairs where geometry is ≥10% off |
| --- | --- | --- |
| kilometres | 1.004× optimal | 20 |
| **hours** | 1.047× optimal | **1,958** |

So the game switched currency, drew the actual roads on the map — you can judge
distance now, which is exactly the trap — and set the budget below what taking
the shortest road costs. On the 2,147 shipped puzzles at a 1.08× budget:

| player | wins |
| --- | --- |
| takes the shortest road, every time | **0%** |
| reads the roads, misjudges their speed, looks three hops ahead | 52% |

## The open questions, answered

1. **Faint distant cities, not strict one-hop visibility.** The deciding number
   isn't the win rate, it's the dead ends: one hop of sight strands a player on
   more than a quarter of puzzles, in corners they had no way to see coming.
2. **No backtracking.** Visited cities aren't selectable. Irreversibility is
   where the tension lives.
3. **A bust doesn't end the round.** The gauge drains to zero and then an
   overrun bar grows back the other way in red, so you can see how deep the hole
   is; you keep going until you arrive, scoring the overspend. Hard-failing at
   the moment of overspend hides how close you were, and the near miss is what
   brings a player back. Dead ends are the only DNF, and they're rare.

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

World mode, fog of war on the city list, streaks and accounts. Nothing here
needs a backend. A distance budget is deferred too — it was built, measured, and
replaced; `docs/SPEC.md` records why.
