# What actually changes the answer: three systems measured

2026-08-23. Findings, not proposals.

The design rests on one requirement: the non-time systems must be able to swing
an outcome, or the fastest road is always right and a second browser tab solves
the game. `2026-08-20-design-intent.md` puts the bar at 20%.

The test is cheap and it is the same every time: **does the system change which
corridor wins?** A cost that scales with time or distance alone cannot, however
large it is, because a uniform tax does not move an argmin.

Three systems have now been measured against it.

---

## 1. Driving hours — inert

Measured against the shipped puzzle set. The naive fastest route and the
game-optimal route were **the same path on 100% of 9,310 puzzles**, and across
399 random city pairs the optimal path differed **zero times**.

The rule fires — 1,278 minutes becomes 1,458 with four mandatory breaks — but it
charges 45 minutes per 270 driven, a near-uniform ~17% tax. Whatever was
fastest stays fastest.

Also worth recording: **the shipped puzzle budgets are calibrated against this
rule**, which the design has since cut. `optimalMin` in `data/puzzles.json` is
the driving-hours number. Every budget is wrong the moment fatigue is redesigned.

---

## 2. Fuel — inert as a cost, real as a range constraint

### The first measurement was of the wrong thing

Priced as a fixed cost per stop, always filling to full, range as a single
number, fuel **never changed the winner** — on either career run, at any range
from 1,200 km down to 350.

The reason is structural: stops ≈ distance ÷ range and stop cost is roughly
constant, so fuel cost is proportional to distance, which is proportional to
time. Another uniform tax. It is even slightly worse than neutral, because
motorway services are dense and the fastest corridor is the one that is mostly
motorway — **fuel rewards the road that already won.**

Range choice does matter, but as a loadout decision rather than a routing one:

| | 1,200 km range | 350 km range | cost |
| --- | --- | --- | --- |
| Cape to Cape | 57h57 | 61h14 | 3h17 |
| Roca to the Bosphorus | 34h30 | 37h02 | 2h32 |

### The measurement that found the real mechanic

Asking "can you find fuel" is the wrong question. With 123,744 stations and a
4 km diversion, **the median gap between reachable fuel is 2.5 km on every
corridor**. Fuel is ubiquitous in Europe and that column says "similar"
everywhere.

The question a cannonball actually faces is whether you can fuel **without
leaving the road**. Measured on service areas only:

| run | corridor | worst stretch with no services |
| --- | --- | --- |
| Cape to Cape | 0 | 383 km |
| | 1 | 450 km |
| | 2 | **738 km** |
| Roca | 0 | 127 km |
| | 1 | **251 km** |

**A 1.9x spread on one run, 2.0x on the other.** That is the range at which a
corridor forces you off the motorway — and it differs by corridor.

Typical car range is roughly 700–1,000 km, so the band where this bites is a car
with **400–700 km of range**. Below it every corridor forces exits; above it
none do. Inside it, **which corridors you can run depends on what you are
driving.**

So fuel is a **loadout-route interaction**, not a routing decision. Aux tanks buy
the corridor with the 738 km gap. A stock tank does not.

### What that means for building it

Worth building: car specs — tank litres and consumption, as a curated table of
perhaps twenty cars. Range follows from those two numbers and it is the whole
mechanic.

Not worth building yet: pump rate, weight-to-consumption feedback, per-stop fill
optimisation. All second-order against a cost that is nearly uniform anyway.

---

## 3. Enforcement — untested, and structurally the best candidate

Not yet measured. It is the only candidate whose cost varies with **place**
rather than with distance or time, which is the property the other two lack. A
corridor through thirty villages carries a completely different exposure from a
motorway corridor of the same length.

The cheapest first test needs **no new data**: speed-limit transitions are
computable from the graph. Police enforce where the limit drops, and a motorway
corridor has almost none while a primary road through villages is full of them.
If that does not vary between corridors, cameras and jurisdiction multipliers
will not rescue it.

---

## The pattern

Two systems built or half-built, two inert. Both failed the same way: their cost
was proportional to something already proportional to time.

**The test before building anything: does the cost vary with WHERE you go, or
only with HOW FAR?** Only the first kind can create a decision.

And a corollary the fuel result taught: **measure the thing the mechanic depends
on, not the mechanic.** Station spacing answered in one script what a full car
model, pump-rate research and weight feedback would have answered after a week
of building — and it answered it differently depending on which column was read.

---

## Data settlement

Everything belongs in exactly one bucket, and the third never pretends to be the
first.

| bucket | meaning | examples |
| --- | --- | --- |
| **Imported** | has a source, refreshable, verifiable | OSM roads, 123,744 fuel stations, speed cameras, collision data, ETSC enforcement intensity |
| **Curated** | small hand-maintained tables of published facts | `countrySpeed`, Schengen membership, **car specs** |
| **Modelled** | parameters we choose, with a rationale and no claim of being data | pump rate (30–50 L/min), weight-to-consumption, patrol behaviour, the weighting between enforcement inputs |

Anything in the third bucket is **labelled as a model wherever a player can see
it**. Same rule as only promising what can be imported and refreshed: if a
player researches a real figure and ours differs, they must be able to tell
whether we claimed it was sourced.
