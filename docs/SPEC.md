# Route — spec

One page. Everything here is settled by measurement; `npm run calibrate`
reproduces the numbers.

## The game in one line

You have a budget of **driving hours**. The roads are drawn, so you can see how
long each one is. What you cannot see is how fast it runs — and across this
graph **the shortest route is the fastest route only 37% of the time**.

## The board

185 European cities, 509 roads, one connected component (`data/graph.json`).
Cities are GeoNames `cities15000` filtered to continental Europe, top-by-
population with a 110 km minimum spacing. Roads are Delaunay + kNN candidates
measured by real OSRM routing — distance, duration, and the road's own geometry —
then filtered:

| rule | why |
| --- | --- |
| more than 3 km on a ferry → not a road | a sea hop is a cost no map can show the player. OSRM's ferry step mode separates the Messina crossing (6.5 km afloat) from the Øresund bridge (0 km) with no hand-curated list |
| road > 420 km → not a road | one hop shouldn't eat a fifth of a budget |
| road / straight-line > 2.0 → not a road | past this it isn't a link, it's a detour around something |
| anything outside the largest component → not in the game | islands and the sparse far north leave on their own terms |

## Visibility

| | during play | after the route is locked |
| --- | --- | --- |
| country outlines | yes | yes |
| the roads out of your current city | yes, drawn as they actually run | all roads taken |
| how long a road takes | only after you commit to it | every hop, with its average speed |
| city names | start, target, and everywhere you can move to | all |
| terrain | no | yes |
| the fastest route, and the shortest one | never | both, drawn against yours |

**This departs from the brief**, which listed "no roads on the base map" as
non-negotiable on the grounds that a visible road network hands the player the
answer. Two things defuse that. You only ever see the roads radiating from where
you are standing, not a network. And because the budget is time, a road's shape
is a clue rather than an answer: a switchbacking mountain road and a motorway
can be the same length, and telling them apart is the skill the game is for.

Without the roads there was no skill at all. Straight-line planning finds the
distance-optimal route at a median cost of 1.004× — the game was a ruler.

## Puzzle selection

A pair qualifies when all four hold. **478 of 8,538 candidate pairs do** — over
a year of daily puzzles.

1. **The short way is measurably slower.** The distance-optimal route costs
   ≥ 1.12× the fastest route's time. 762 pairs clear this.
2. **It is winnable.** A good run by the simulated player comes in under budget.
3. **It is not free.** A sloppy run by the same player does not.
4. **Losing is a near miss.** The worst realistic run is ≤ 1.45× the best time.

Criteria 2–4 are measured by running `roadReader` (`play/bots.mjs`) twelve times
per pair. That bot is the spec's model of a player: it sees every road's length
exactly, forms a view on how fast each runs that is off by a consistent amount,
looks three hops ahead, and estimates the rest of the trip at a flat average.

Bounds: fastest route 12–40 hours, 7–16 hops.

## Budget

    budget = round(fastest route in minutes × 1.08, to the nearest 15 minutes)

The multiplier is the only difficulty dial. 1.08 comes from the sweep:

| multiplier | shortest-road player wins | road-reader wins | median win margin | median bust |
| --- | --- | --- | --- | --- |
| 1.04 | 0% | 32% | 0.7h | 2.3h |
| **1.08** | **0%** | **51%** | **1.3h** | **2.9h** |
| 1.12 | 0% | 62% | 2.2h | 2.9h |
| 1.15 | 51% | 68% | 2.8h | 2.8h |

The multiplier must stay below the point where taking the shortest road starts
getting away with it. Past 1.12 the trap stops being a trap.

## Rules

- Start on the origin city. Each turn, pick any adjacent city you have not
  already visited. Pay the hours that road takes.
- **No backtracking.** Visited cities are not selectable. Irreversibility is
  where the tension comes from.
- **A bust does not end the round.** The gauge goes red and negative and you keep
  going until you arrive. A hard fail at the moment of overspend hides how close
  you were, and the near miss is what brings a player back tomorrow.
- **Dead ends end the round.** If every neighbour is already visited, that's a
  DNF. Rare, and always the player's own doing.

## Scoring

    score = budget − driving time     (hours to spare, higher is better)

Negative when busted.

## Share string

Four lines, no spoilers. The glyphs record how each road ran, not which cities
were chosen.

    Route #142 · Geneva → Pristina
    23h12 / 24h30
    ·◆·▲··◆
    +1h18

`·` motorway pace (≥ 85 km/h) · `◆` ordinary going (65–85) · `▲` slow road (< 65).

## Deferred

World mode; fog of war on the city list; streaks and accounts. Also deferred and
specific to this build: **Britain, Ireland and the islands**, excluded because
every route onto them runs through a ferry or the Chunnel, and **Finland and the
far north**, whose only land links are longer than the 420 km hop cap.

A **distance budget** is now deferred too, having been built and measured: it
made a game that geometry solves outright, and the switch to time is what this
spec documents.
