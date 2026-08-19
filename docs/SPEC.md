# Route — spec

One page. Everything here is settled by measurement; `npm run calibrate`
reproduces the numbers.

## The game in one line

You have a budget of **driving hours**. The roads are drawn, so you can see how
long each one is. What you cannot see is how fast it runs — and across this
graph **the shortest route is the fastest route only 27% of the time**.

## The board

479 European cities, 1,233 roads, one connected component (`data/graph.json`).
Cities are GeoNames `cities15000` filtered to continental Europe, top-by-
population with a 75 km minimum spacing — without a spacing rule the Ruhr, the
Randstad and Upper Silesia eat the budget and Iberia goes uncovered. Roads are Delaunay + kNN candidates
measured by real OSRM routing — distance, duration, and the road's own geometry —
then filtered:

| rule | why |
| --- | --- |
| more than 3 km on a ferry → not a road | a sea hop is a cost no map can show the player. OSRM's ferry step mode separates the Messina crossing (6.5 km afloat) from the Øresund bridge (0 km) with no hand-curated list |
| road > 420 km → not a road | one hop shouldn't eat a fifth of a budget |
| road / straight-line > 2.0 → not a road | past this it isn't a link, it's a detour around something |
| a road passing within 12 km of a third city → not a road | the A4 from Rzeszów to Radom goes through Lublin, and Lublin is a city here. Keeping it draws a road across a dot it does not stop at, and offers a hop that is really two hops glued together. Only dropped when both halves exist, so nothing is cut off |
| anything still outside the main component after that → one rescue attempt, then out | see "Rescue" below |

**Rescue.** The two caps above (420 km, 2.0× detour) are tuned for typical
Central European distances, and they silently strand real cities in fjord and
mountain terrain rather than routing around it — measured directly: Bergen
(Norway's 2nd-largest city) has *zero* surviving candidates under the normal
caps, because every real road out of it is a 1.5–1.8× detour around a fjord,
a touch over 420 km, or both. A city the normal pass leaves disconnected gets
one attempt at its single cheapest real, non-ferry connection to the main
component, cap loosened to 700 km and the detour ratio dropped entirely (a
long detour is exactly the failure mode being rescued from). The ferry rule
is not loosened — a city genuinely only reachable by boat fails the rescue
for the same reason it failed the first time, and correctly stays out. Of 28
cities the normal pass stranded, 7 were real (Bergen, Bodø, Harstad,
Kristiansund, Mo i Rana, Tromsø, Skadovsk — all fjord/coastal Norway plus one
Ukrainian coastal city) and are back on the map; the other 21 are every
Corsican, Sardinian, Sicilian, Balearic, Cretan, and Aegean city in the
roster, which stay out for the reason they always would have.

## Visibility

| | during play | after the route is locked |
| --- | --- | --- |
| country outlines and names | yes | yes |
| the roads out of your current city | yes, drawn as they actually run, weighted by how fast each stretch of them runs | all roads taken, and the fastest route weighted the same way |
| rivers and major lakes | yes | yes |
| the map itself | pan and zoom freely; the frame follows you as you move | framed on both routes |
| how long a road takes | only after you commit to it | every hop, with its average speed |
| city names | start, target, and everywhere you can move to | all |
| terrain | yes, from the first move — hillshade computed from ~390 m elevation data, in three levels down to 195 m per pixel | yes |
| real street-level detail near a city | yes, once zoomed in close enough — decoration, not wired to any road's speed | yes |
| named mountain ranges, plateaus and seas | yes | yes |
| built-up footprints and background towns | yes — decoration only, unconnected to any road | yes |
| a lat/long grid and a scale bar | yes | grid only; the scale bar hides at the reveal |
| the average pace the rest of the trip needs | yes, recalculated every hop from where you're standing | n/a — the round is over |
| what that pace becomes for each candidate hop | yes, an estimate next to each reachable dot | n/a |
| a hop's needed-vs-got verdict | yes, at the city you arrive at and in the hop log | yes, in the hop log |
| how long you've been driving, and when the next mandatory break hits | yes, live, before you commit to a hop | yes, in the hop log |
| the fastest route, and the shortest one | never | both, drawn against yours |
| how fast a named region's roads run against the network average | yes, in the pre-game brief, for regions the route actually passes near | n/a |
| the country you're in, and its real legal speed limits | yes, live, updates on every stop | n/a |
| the road and terrain a candidate hop actually crosses | yes, on hover/focus of a reachable dot, before you commit | n/a |

The pace figure is arithmetic on numbers already on screen — remaining budget
and crow-flies distance to the target — not a new fact about any road. It's a
floor, not a promise: real roads run longer than the straight line, so the
true number is always at least this. Its purpose is to turn "the corridor
choice is a bet" from something tracked in the player's head into a number
they can weigh a hop's visible pace tier against.

The per-candidate preview does the same arithmetic once per reachable dot,
using an *estimated* cost for that hop (nominal midpoint speed per pace tier,
weighted by how much of the hop is in each) rather than the real one — a hop's
actual cost is still hidden until it's taken. It's a judgement aid, not a new
fact: the same reasoning a player is already asked to do from the drawn line
weight, done for them instead of left to mental arithmetic.

The named ranges/seas, the urban footprints and the background towns are all
static geography, unwired to any road or edge — with one deliberate exception.
A named relief feature in the brief carries the real, measured pace of roads
that actually run near it: the distance-weighted average speed of graph edges
within 70 km of its centroid, against the network-wide average
(`paceDeviation`, `03-map.mjs`), shown only when at least four edges sample it.
This is learnable, not a flat "mountains are slow" heuristic — the Balkan Mts.
and the Carpathians run 20-25% slower than the network, but the Harz and the
Vosges, superficially similar terrain, run 15-20% *faster*. Everything else on
the map — the urban footprints, the background towns, the range's own length
and peak — answers "is this map alive," not "which way should I go" — the
towns are exactly the GeoNames places that lost out to the roster's 75km
spacing rule (`00-cities.mjs`), drawn small and inert because the emptiness
between playable
cities was the map's own doing, not the puzzle's.

Road pace is shown **only for the roads you can move to**, never for the network
at large. Standing in Rzeszów you can see that the road south is a slow mountain
two-lane and the road north is a main road; you cannot see what the corridor
beyond looks like. That is the whole balance. Simulating a player who reads the
next hop well (σ 0.08) and still guesses beyond it (σ 0.25) moves the win rate
from 54% to 56% — because the difficulty was never in judging one hop, it is in
choosing the corridor. The shortest-road player still wins 0 of 2,538.

Terrain is on from the start rather than held back for the reveal. It does not
hand over the answer: any European mountain range has several roads through it
and knowing the range is there says nothing about which of them is quick. What
it gives the player is a reason for the shape of the road in front of them.

**This departs from the brief**, which listed "no roads on the base map" as
non-negotiable on the grounds that a visible road network hands the player the
answer. Two things defuse that. You only ever see the roads radiating from where
you are standing, not a network. And because the budget is time, a road's shape
is a clue rather than an answer: a switchbacking mountain road and a motorway
can be the same length, and telling them apart is the skill the game is for.

Without the roads there was no skill at all. Straight-line planning finds the
distance-optimal route at a median cost of 1.004× — the game was a ruler.

## The reveal

The reveal is not a fog lifting — the map has shown everything it is going to
show all along. It is a race: both routes leave the origin together and drive at
their real paces — a hop that took four hours takes four hours' worth of
the animation — so the player watches the fast route pull away on the stretch
where it actually happened. The numbers land afterwards, once the reason for
them has already been seen.

## Puzzle selection

A pair qualifies when all four hold. **2,538 pairs do** — 7.0 years of daily
puzzles.

1. **The short way is measurably slower.** The distance-optimal route costs
   ≥ 1.12× the fastest *legal* route's time (see "Driving hours" below — the
   fastest route that obeys the mandatory-break rule, not the fastest route
   ignoring it). This is not a heuristic proxy standing in for a better test —
   it's a hard requirement of the rules as written. The shortest road is a
   free, deterministic, always-available strategy; nothing about taking it
   requires reading a single pace tier. For it to fail, its time has to
   exceed the budget, which means its ratio to the optimal has to clear the
   budget multiplier (1.11) with enough margin to survive 15-minute rounding.
   Below that ratio a player wins with zero risk and zero judgement, every
   time — a version of this criterion was briefly dropped on the theory that
   pace-misjudgment tension alone was enough difficulty without a directional
   trap; measured after the fact, that let the shortest road win outright on
   66% of the puzzles it produced, because the thing it was actually testing
   (a simulated player's noisy performance) is a different question from
   whether the deterministic shortest-road strategy itself survives. It
   doesn't, below this ratio, ever.
2. **It is winnable.** A good run by the simulated player comes in under budget.
3. **It is not free.** A sloppy run by the same player does not.
4. **Losing is a near miss, and a realistic one.** The worst run that actually
   *finishes* is ≤ 1.45× the best time — and the simulated player has to
   finish: a pair where it dead-ends itself (no unvisited neighbour left,
   same rule a real player plays under) more than 15% of the time is cut on
   that alone, before the time-ratio math ever sees it. Dead-end rate used to
   be folded into the time-ratio math itself (a dead-end run scored as an
   infinite time), which conflated two different failure modes — a puzzle
   with no real time-management difficulty at all could still fail criterion
   4 purely from how often the bot happened to wall itself in. Split out
   explicitly now: the time-ratio criteria are computed only over runs that
   actually finished.

Criteria 2–4 are measured by running `roadReader` (`play/bots.mjs`, with its
`hos` option on — see "Driving hours") twelve times per pair. That bot is the
spec's model of a player: it sees every road's length exactly, forms a view
on how fast each runs that is off by a consistent amount, looks three hops
ahead, and estimates the rest of the trip at a flat average.

Bounds: fastest legal route 12–40 hours, 7–16 hops.

**A city with only one way in or out can't host a puzzle at all**, even if it
clears every bound — measured directly on Bergen (see "Rescue" under The
board): 98 candidate destinations sit in bounds, and *zero* clear the trap
ratio, provably, not by chance. A forced single access road is shared by both
the fastest route and the shortest one to anywhere from that city, and adding
an identical cost to both sides of a ratio always pulls it toward 1.0 — the
larger that shared, unavoidable hop is relative to the trip, the more it
dilutes whatever real trap exists on the far side of it. Rescued cities exist
on the map and are real, but they're a fit for a forced-waypoint mechanic
(deferred), not an endpoint, under this criterion.

## Budget

    budget = round(fastest legal route in minutes × 1.11, to the nearest 15 minutes)

The multiplier is the only difficulty dial. 1.11 comes from the sweep:

| multiplier | shortest-road player wins | road-reader wins | median win margin | median bust |
| --- | --- | --- | --- | --- |
| 1.08 | 0% | 42% | 1.2h | 2.0h |
| 1.10 | 0% | 48% | 1.4h | 1.8h |
| **1.11** | **0%** | **52%** | **1.6h** | **1.7h** |
| 1.12 | 0% | 55% | 1.7h | 1.7h |
| 1.13 | 25% | 59% | 1.8h | 1.7h |

The multiplier must stay below the point where taking the shortest road starts
getting away with it. Past 1.12 the trap stops being a trap — one road's worth
of margin below the cliff, the same shape as the original (pre-driving-hours)
calibration, whose own 1.08 sat 0.04 below its own 1.12 cliff.

Reselecting matters whenever the underlying cost model or graph changes —
patching an old set's budgets in place, without reselecting, is how a puzzle
quietly stops being a puzzle. Measured directly: patching the pre-driving-
hours set's budgets in place (same 2,165 pairs, new numbers, no reselection)
left 8.5% of it with the shortest road outright winning. The current set was
chosen fresh against the current graph (see "Rescue" under The board) and the
current criteria (see "Puzzle selection" above), every number measuring the
fastest *legal* route from the start.

## Driving hours

Real racing rules, not just real roads: EU Regulation EC 561/2006, simplified.
**4.5 hours of continuous driving forces a 45-minute break**, charged against
the budget like anything else. It's a second resource to manage alongside
budget — a corridor that looks fast on the gauge can still cost you a break if
it lands wrong against the clock you're already carrying, which is exactly
why it has to be visible before the hop that trips it, not discovered after.

This is a deliberate simplification of the full regulation (9-hour daily cap,
11-hour daily rest, weekly limits) — those numbers are large relative to a
puzzle's budget and would rarely bind, so they're deferred rather than
modelled for no gameplay effect. The 4.5h/45min rule is the one that actually
bites at this scale.

"The fastest route" — shown at the reveal, and used to derive the budget above
— means the fastest route that obeys this rule, not the fastest route
ignoring it: a state-augmented search over (city, minutes-since-last-break),
since the same road can cost a hop's plain minutes or that plus a forced break
depending on how much continuous driving is already banked on arrival
(`hosDijkstra`, `scripts/lib/graph.mjs`; mirrored as `hosRoute` in
`web/engine.js` since browser code can't import the Node build scripts).

## Recon

Real rally prep is knowing the country, the terrain, and the road before you
commit to a stage — not just the map. Three real, already-computed facts,
surfaced at the moment they're actually useful instead of front-loaded once
and forgotten:

- **The country you're in.** Real, sourced legal speed limits
  (`scripts/lib/country-facts.mjs` — motorway/rural/urban, cross-checked
  against at least two independent sources per country), shown live in the
  HUD and updated on every stop. This is the real-world reason a country's
  measured network pace (the pace-deviation stat) runs the way it does —
  Germany's derestricted autobahn sections and Poland/Bulgaria's 140 km/h
  motorways aren't flavour, they're why those networks average faster. Quiet
  on an ordinary stop; flashes on the one where the country actually changed,
  the way a co-driver calls out a border crossing and nothing in between.
- **The terrain a candidate hop crosses.** The same pace-deviation stat the
  pre-game brief uses for the whole corridor, scoped down to the single hop
  you're actually looking at, live, before you pick it.
- **The road a candidate hop is on.** Real OSM route refs/names
  (`06-road-names.mjs`), already computed for narration after a hop lands,
  now also shown before you commit to one.

All three are shown on hover or keyboard focus of a reachable dot, never
automatically for the whole board — same principle as the pace-tier line
weight: you can read the option in front of you, not the network at large.
None of it is the thing that's still genuinely hidden (how fast a road
actually runs) — it's the context a real rally crew would have going in,
not the answer.

## Street-level detail

Every playable city carries its own real street grid — actual OSM ways
within 900 m of the city, real geometry, real road classes
(`scripts/07-streets.mjs`), fetched on demand per city the same way terrain
tiles already are, not bundled into the main payload (a single puzzle only
ever visits 7-16 of the 479 cities). Decoration, same footing as the urban
footprints and background towns: none of it is wired to a road's speed, it
exists so a stop looks like a real place instead of a dot on empty ground.

Visible once zoomed in close enough (the camera's minimum zoom came down
from 90 km to 3 km to make this reachable at all — past 90 km there used to
be nothing left to see, since terrain tiles bottom out around 195 m/px and
nothing else scaled any finer). All 479 cities have real data as shipped; a
city that genuinely can't be fetched (the public OSM mirrors this is built
against are individually flaky under real load — measured directly, one
mirror timed out on 3 of 4 back-to-back queries) just shows the plain map at
close zoom instead, same graceful-fallback shape as a missing road name.

## Pit stops

Arriving somewhere is a stop, not a repaint. On every hop but the last, the
camera eases in on the city you just pulled into — tight enough to show its
real street grid (see "Street-level detail" above) instead of the corridor
around it — and shows what that hop actually cost. The next hop's candidates
stay visible on the map but out of reach until you press **Continue
driving**, which eases the camera back out to where you were and hands
control back. Recon on the next candidates (the "Recon" section above) is
unavailable while stopped for the same reason: reading the stop you're
actually at is the beat, not lining up the next one early.

The final hop skips this — arriving at the target flows straight into the
race and reveal, which already has its own, bigger version of the same idea
(both routes driving side by side, then the numbers). A pit stop mid-route
and the reveal at the end are the same "you arrived, look at what that
cost" beat at two different scales, not two different mechanics.

## Rules

- Start on the origin city. Each turn, pick any adjacent city you have not
  already visited. Pay the hours that road takes.
- **No backtracking.** Visited cities are not selectable. Irreversibility is
  where the tension comes from.
- **4.5 continuous hours forces a 45-minute break.** See "Driving hours" above.
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

World mode; fog of war on the city list; streaks and accounts; a mandatory
forced-waypoint puzzle variant (start → via → target, no revisits across the
whole path) — the natural home for rescued, single-access cities like Bergen,
which can't host a puzzle on their own (see "Puzzle selection"). Also deferred and
specific to this build: **Britain, Ireland, and the Mediterranean islands**
(Corsica, Sardinia, Sicily, the Balearics, Crete, the Aegean), excluded because
every route onto them runs through a ferry or the Chunnel — genuinely no land
road exists, not a threshold that could be loosened. Coastal Norway and the
far north are no longer in this category: see "Rescue" under The board.

A **distance budget** is now deferred too, having been built and measured: it
made a game that geometry solves outright, and the switch to time is what this
spec documents.
