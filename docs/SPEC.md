# Route budget — spec

One page. Everything here is settled by data from Phases 0–2; the reasoning
lives in the commit history and in `play/calibrate.mjs`.

## The board

185 European cities, 509 road edges, one connected component
(`data/graph.json`). Cities are GeoNames `cities15000` filtered to continental
Europe, top-by-population with a 110 km minimum spacing. Edges are Delaunay +
kNN candidates measured by real OSRM road routing and then filtered:

| rule | why |
| --- | --- |
| more than 3 km on a ferry → not an edge | a sea hop is a cost no map can show the player. OSRM's ferry step mode separates the Messina crossing (6.5 km afloat) from the Øresund bridge (0 km) with no hand-curated list |
| road > 420 km → not an edge | one hop shouldn't eat a fifth of a budget |
| road / straight-line > 2.0 → not an edge | past this it isn't a link, it's a detour around something |
| anything left outside the largest component → not in the game | islands and the sparse far north leave on their own terms |

## Puzzle selection

A pair qualifies as a puzzle when all four hold. 278 of 11,224 candidate pairs do.

1. **The obvious move is wrong.** Naive play — always hop to whichever
   reachable city is closest to the target as the crow flies — costs ≥ 1.15×
   optimal. 874 pairs clear this.
2. **It is winnable.** A good run by the simulated player comes in under budget.
3. **It is not free.** A sloppy run by the same player does not.
4. **Losing is a near miss.** The worst realistic run is ≤ 1.6× optimal, so a
   loss is 100 km short, not a walk down the Italian boot and back.

Criteria 2–4 are measured by running `humanish` (`play/bots.mjs`) twelve times
per pair. That bot is the spec's model of a player: it looks three hops ahead,
estimates the rest of the trip as a straight line, and misjudges every distance
by a consistent per-edge amount.

Bounds: optimal 900–3200 km, 5–16 hops.

## Budget

    budget = round(optimal × 1.15, to the nearest 10 km)

The multiplier is the only difficulty dial and it is global. 1.15 comes from a
sweep (`npm run calibrate`), not from taste:

| multiplier | simulated player wins | median win margin | median bust |
| --- | --- | --- | --- |
| 1.10 | 33% | 104 km | 373 km |
| **1.15** | **48%** on all pairs, **63%** on selected pairs | **169 km** | **179 km** |
| 1.25 | 66% | 293 km | 1621 km |

The brief guessed 1.2–1.3. That was measured as too soft: at 1.25 the naive
player wins 43% of the time, which means the puzzle stops asking anything.

## Visibility

| | during play | after the route is locked |
| --- | --- | --- |
| country outlines | yes | yes |
| terrain | no | yes |
| city dots | all of them, distant ones faint | all |
| city names | start, target, and cities you have already stood in | all |
| road distance of a hop | only after you commit to it | all hops, plus travel time |
| the optimal route | never | drawn against yours |

Distant cities stay faintly visible rather than hidden. This is a measured
choice: a player restricted to one-hop visibility is the `estimator` bot, which
wins 35% of the time and busts by walking into dead ends it had no way to see.
With the corridor visible the same player wins 63%. Faint visibility is the
difference between a puzzle and a trap.

Names are withheld for cities you haven't visited because identifying the dot is
part of the puzzle — knowing a dot is Innsbruck tells you it is in the Alps.
The terminal playtest (`play/cli.mjs`) names every option, because without a map
the name is the only way to point at a city; the browser game does not.

## Rules

- Start on the origin city. Each turn, pick any adjacent city you have not
  already visited. Pay its road distance.
- **No backtracking.** Visited cities are not selectable. Irreversibility is
  where the tension comes from.
- **A bust does not end the round.** The gauge goes red and negative and you
  keep going until you arrive. A hard fail at the moment of overspend hides how
  close you were, and the near miss is the thing that brings a player back
  tomorrow. Arriving 40 km over is a story; "FAILED" is not.
- **Dead ends end the round.** If every neighbour is already visited, that's a
  DNF. Rare, and always the player's own doing.

## Scoring

    score = budget − distance travelled     (leftover kilometres, higher is better)

Negative when busted. No time component in v1 — durations are in the data and
are shown at the reveal, but the budget is distance.

## Share string

Four lines, no spoilers: the glyphs encode how surprising each hop's terrain was,
not which cities were chosen.

    Route #142 · Prague → Šiauliai
    1735 / 1550 km
    ·◆·▲··◆
    −185 km

`·` the road ran near enough straight (< 1.15× the straight line) ·
`◆` a detour (1.15–1.35×) · `▲` the terrain charged for it (> 1.35×).

## Deferred

World mode; time budgets instead of distance; fog of war on the city list;
streaks and accounts. Also deferred, and specific to this build: **Britain,
Ireland and the islands**, which are excluded because every route onto them runs
through a ferry or the Chunnel, and **Finland and the far north**, whose only
land links are longer than the 420 km hop cap. Both come back with world mode's
hand-curated sea crossings.
