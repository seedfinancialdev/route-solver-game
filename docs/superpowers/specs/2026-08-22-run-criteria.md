# Run criteria: what makes a route a cannonball

2026-08-22. Replaces the generation criteria in `data/puzzles.json`
(`MIN_HOURS` 12, `MAX_HOURS` 40, `MIN_HOPS` 7–16), which were written for
city-hop puzzles and were flagged as needing a fresh pass in commit 6df541e.

A route is only worth shipping if it clears every gate below.

---

## A. Scope — is it a cannonball at all

| gate | value | why |
| --- | --- | --- |
| Road distance | **≥ 2,500 km** | Below this it is a drive, not a run. Gibraltar→Warsaw is ~3,700. |
| Elapsed at legal speed | **24–72 h** | Anchored to the real thing: NY→LA is 42 h by Google, ~26–29 h at record pace. Upper bound set by Cape to Cape, measured at 65 h — a team can still realistically push that continuously. Refine down if it proves too loose. |
| Countries crossed | **≥ 4** | Forces jurisdiction to matter. |
| Terminal endpoints | **both** | Coast, national extremity, or map edge. Not two interior cities. |
| Named endpoints | **both** | A specific findable place, as the real thing uses — Red Ball Garage → Portofino Hotel. Not "Warsaw". |

**Terminal** means the route cannot be meaningfully extended in the same
direction. Gibraltar, Nordkapp, Lisbon, Tarifa, Istanbul, Tallinn qualify.
Frankfurt does not.

---

## B. Strategy — is there a decision in it

| gate | value | why |
| --- | --- | --- |
| Distinct corridors | **≥ 2** within **+20%** of optimal, under 65% shared distance | One corridor is not a choice. +20%, not +15%: measured twice — on the curated graph (2026-08-21) and on the real Iberian network (2026-08-22) — variety simply does not exist at tighter tolerance. It is also the same number as the systems-swing bar, and deliberately so: the systems must be able to swing 20% precisely so that +20% corridors become reachable. |
| Corridor character spread | corridors must differ in **road-class mix** by ≥ 0.10 | Four ways to drive the same road is not variety. Measured 2026-08-21; 0.10 is the published "genuinely different roads" threshold. |
| Shortest ≠ fastest | shortest route **≥ 12 %** slower than optimal | The thesis of the game. Carried over from the old criteria, which got this part right. |

Note: with every road playable, corridors are no longer paths through a
2,160-edge graph. They must be computed over the real network. The corridor
measurement needs rebuilding on that basis before these gates can run.

---

## C. Constraint bite — is it un-copyable

Measured 2026-08-22: the naive fastest route is **identical to the game-optimal
route on 100 % of the current puzzle set**. A run that does not clear these
gates can be solved from a second browser tab.

| gate | value |
| --- | --- |
| Fuel forces a real choice | at least one stretch where range makes the obvious corridor need an extra stop |
| Borders bite | at least one competitive corridor crossing a non-Schengen border |
| Jurisdiction spread | corridors differ in country mix, so enforcement risk differs |
| **Google penalty** | the pure-time optimum is **≥ 10 %** off the best achievable once systems apply |

These cannot be measured until fuel, borders and enforcement exist. Until then
they are gates on paper — but the Google-penalty gate is the one that decides
whether the game is a game, so nothing ships without it.

---

## D. Verification

Clock starts at departure and never stops. No rest credit, no stop credit —
every stop is pure elapsed time. Deterministic replay from recorded inputs is
the proof, and `core-loop/` already does it.

---

## Route styles, checkpoints, and circuits

A run is **start, optional checkpoints, finish**. A circuit is a run whose
finish is its start. Checkpoints are the author's control over route shape —
add as many as the route needs.

**Ordered** checkpoints fix the sequence, so the author controls the shape and
the player's decision stays corridor choice. **Unordered** checkpoints hand the
player a sequencing problem instead, and are gated differently.

A circuit **must** carry at least one checkpoint. Without one it is degenerate:
drive a hundred metres, turn round, finish.

### The sequencing gate

For unordered checkpoints, "≥2 distinct corridors" is the wrong question —
there is no single origin-destination pair. The gate is instead:

> **Greedy nearest-next must cost at least +10% against the optimal order.**

Measured against *greedy*, not against the median ordering and not against the
authored one. The authored order only tests the author. The median tests
whether variance exists, which is not the same as whether the answer is hard —
measured on the Britain circuit the median ordering costs +45% and the worst
+77%, but a coastal ring has an obvious solution and going round the coast in
order is nearly optimal. Greedy nearest-next is what a competent player
actually does, so the gap to it is the size of the real decision.

Britain clears it at +13%.

*Consequence for authoring:* checkpoints strung round a perimeter make a weak
circuit. Scattered checkpoints, where the good order is not the order your eye
suggests, make a strong one.

---

## Career and daily

**Career runs** are hand-picked. Terminal endpoints are editorial, not
algorithmic — there are perhaps 40 of them in Europe and choosing which ones
carry a run is a judgement. Start with 2–5.

**Daily runs are derived from career runs, not generated fresh.** The content
model says literacy comes from meeting the same roads repeatedly; procedurally
generated short routes would mean rarely driving the same road twice, which the
design intent explicitly rejects.

Dailies are drawn from the **union of roads the career routes use**, not from
one specific route. Same benefit — everything practised is something the career
runs actually need — with a far larger pool. Roughly: 40 career routes at
~3,700 km cut into ~400 km legs gives ~360 non-overlapping dailies, about a
year. Sliding windows over the union give years.

A daily must still clear section **B** at its own scale. A 400 km leg with one
viable corridor is a formality, not practice. Section **A** does not apply —
a daily is a leg, not a cannonball.

---

## Not gates

Vehicle failure, weather, and traffic are **systems**, not route filters. They
vary a run; they do not decide whether a route is worth generating.

---

## Open

- Terminal endpoints need a real list. Probably hand-picked — there are maybe
  40 of them in Europe and picking them is editorial, not algorithmic.
- Whether daily/practice runs use a relaxed version of A, or are a different
  object entirely with their own criteria.
- Whether islands beyond Great Britain are worth adding. The road-only rule
  makes each one a closed system: no borders, no jurisdiction variety, and
  point-to-point runs on them tend to be corridor-poor — Land's End to John
  o' Groats measured 1,349 km with exactly ONE corridor within +20%, because
  the M5/M6/A74/A9 spine dominates. Islands earn their place as circuits.
- The corridor measurement has to be rebuilt over the real road network.
