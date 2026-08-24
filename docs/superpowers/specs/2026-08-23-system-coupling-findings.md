# What actually changes the answer: six systems measured

2026-08-23. Findings, not proposals.

The design rests on one requirement: the non-time systems must be able to swing
an outcome, or the fastest road is always right and a second browser tab solves
the game. `2026-08-20-design-intent.md` puts the bar at 20%.

The test is cheap and it is the same every time: **does the system change which
corridor wins?** A cost that scales with time or distance alone cannot, however
large it is, because a uniform tax does not move an argmin.

Six systems have now been measured against it. One passed.

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

## 3. Enforcement exposure — varies, but in the reinforcing direction

Measured without new data, using speed-limit transitions: police enforce where
the limit drops, so a motorway has almost none and a primary road through
villages is made of them.

Exposure does vary — 1.8x on limit drops per 100 km, 5x on urban share. But the
direction is wrong:

| Cape to Cape | drops/100km | urban share |
| --- | --- | --- |
| corridor 0 (fastest) | 5.4 | 0.3% |
| corridor 1 (+7.2%) | 6.9 | 0.5% |
| corridor 2 (+18.7%) | 9.6 | 1.7% |

**The fastest corridor has the least exposure.** The slow corridors are slow
because they use primary roads through villages, which is the same reason they
are policed. Enforcement widens the gap rather than closing it — the same
failure as fuel.

Recorded as a method note: *variance is not the test.* Three measurements in a
row reported "differs materially" when what mattered was whether the difference
could **reverse** a ranking. It could not.

---

## 4. Traffic — the largest system by far, and the metric nearly hid it

### Percentage of total was the wrong measure

Measured as a share of run time, departure timing looked negligible on long
runs: 1.5% on Cape to Cape, 3.8% on Roca. That conclusion was an artifact of
dividing by a large number.

In absolute terms:

| run | traffic costs | departure choice worth |
| --- | --- | --- |
| Roca to the Bosphorus (34 h) | 4h55 – 6h24 | **1h30** |
| The Grand Tour (75 h) | 9h59 – 11h24 | **1h29** |

Traffic is the largest system measured — bigger than everything else combined.
And ninety minutes is decisive in a race where the field is separated by far
less.

### Departure sets the PHASE of a sequence of encounters

Metro encounters stay essentially constant whatever time you leave — 64-65 on
Roca, 114 on the Grand Tour. What changes is how many are hit at peak:
**18 to 34, nearly double.** Same cities, different phase.

That also corrects the run-length conclusion. Departure leverage is ~1h30 on a
34-hour run and ~1h29 on a 75-hour one — **it does not decay in absolute terms**.
Only the percentage shrinks, because the denominator grows. Against an absolute
record, a longer run gives more room to win or lose, not less.

### What it still does not do

Departure timing does not change which corridor or which order wins. Every
corridor slows together. But that is a narrower question than whether it is a
decision, and ninety minutes plainly is one.

### Not yet modelled: incidents

An accident is discrete, route-specific and time-specific. It cannot average out
the way recurring congestion does, and it is the one thing that could make a
slower corridor suddenly correct. The snapshot mechanism the design intent
already specifies for weather is the right shape for it.

---

## 5. Checkpoint ordering — the first genuine decision

Checkpoints inside cities, pass-through rather than stops, visitable in any
order. The Grand Tour: Barcelona to Istanbul by way of Paris, Munich, Rome and
Copenhagen.

| | |
| --- | --- |
| median ordering costs | **+17.3%** |
| worst ordering costs | **+32%** |

The first system to change the answer. Everything else measured zero.

The winning order is not obvious either — **Barcelona, Paris, Copenhagen,
Munich, Rome, Istanbul**, a northern sweep before turning south-east.

Why this works where corridors did not: a motorway route *bypasses* city
centres, so through-traffic barely touches it. A checkpoint inside the city
forces urban penetration, which is where traffic actually bites — measured at
66% on an 86 km leg through the Randstad.

**Caveat:** four intermediate checkpoints is 24 orderings, which a player can
brute-force if the planner shows exact times. Six is 720, eight is 40,320. The
other half of the answer is that the planner should not hand over solved
numbers — estimating against forecasts keeps ordering a judgement.

**Ordering does not interact with departure time.** The same order wins at every
hour. They are two independent decisions rather than one coupled problem.

---

## 6. How many checkpoints — the difficulty curve

Ordering is the only system that changed the answer, so the follow-up is a
design parameter. Measured over **every subset of eight candidate cities**
between Barcelona and Istanbul — Paris, Amsterdam, Copenhagen, Berlin, Munich,
Vienna, Rome, Milan — which is 247 distinct races.

| checkpoints | races | orders | median order | per checkpoint | worst order | greedy plan | traffic-blind | within 1% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 28 | 2 | +14.8% | +7.4% | +14.8% | +2.6% | +0.0% | 51.8% |
| 3 | 56 | 6 | +17.5% | +5.8% | +27.9% | +6.8% | +0.0% | 19.6% |
| 4 | 70 | 24 | +21.9% | +5.5% | +37.4% | **+10.3%** | +0.0% | 5.2% |
| 5 | 56 | 120 | +27.4% | +5.5% | +48.9% | **+12.8%** | +0.0% | 1.1% |
| 6 | 28 | 720 | +33.4% | +5.6% | +57.6% | +16.9% | +0.0% | 0.2% |
| 7 | 8 | 5,040 | +39.4% | +5.6% | +67.3% | +22.1% | +0.1% | 0.0% |
| 8 | 1 | 40,320 | +46.0% | +5.7% | +76.3% | +26.3% | +0.0% | 0.0% |

*greedy plan* is nearest-unvisited-city, priced under traffic. *traffic-blind*
is the best order chosen on a free-flow map, priced under traffic.

### Permutation count is not difficulty

The median penalty looks like it explodes — +14.8% to +46.0% — but the
per-checkpoint column shows it is **flat at about 5.5% each from three
onwards**. Median ordering cost grows linearly in checkpoint count. Nothing
about the *size* of the penalty accelerates.

What actually gets harder is finding the answer:

| | 2 checkpoints | 4 | 6 |
| --- | --- | --- | --- |
| greedy is already optimal | 20 of 28 races | 9 of 70 | 0 of 28 |
| orders within 1% of best | 51.8% | 5.2% | 0.2% |

At two checkpoints **half of all orderings are effectively tied** and the
obvious plan is usually right — there is no decision, whatever the spread says.
By six there is exactly one right answer and no heuristic finds it.

That confirms the gate `2026-08-22-run-criteria.md` already chose: measure
against **greedy**, not against the median. The median moves smoothly and says
nothing. Greedy is the difficulty.

### The sweet spot is four to five

| | verdict |
| --- | --- |
| 2–3 | greedy is optimal on 37–71% of races. A formality. |
| **4–5** | greedy costs +10.3% / +12.8%, near-ties down to 5.2% / 1.1%, 24–120 orders. A judgement a person can make. |
| 6+ | greedy never wins and near-ties vanish, but 720+ orders and a 66-hour run make it a solver's job rather than a decision. |

Four is also where the existing `greedy ≥ +10%` sequencing gate first clears
reliably. That threshold now has a measured meaning rather than a guessed one.

### Traffic does not affect ordering at all

The free-flow-optimal order is the traffic-optimal order on **233 of 247
races**, and where it differs it costs **at most +0.4%**. A player who plans the
sequence with no idea about traffic loses nothing.

This is the fifth system to come back inert on "does it change the answer", and
it is the sharpest one yet, because traffic is otherwise the largest system
measured (5–11 hours). Traffic is priced into **the clock**, not into the order.
Departure timing is worth ~1h30; knowing about traffic when sequencing is worth
nothing.

Re-measured at 03:00, 06:00 and 21:00: the whole curve is identical to within
0.5%. Ordering difficulty does not depend on departure hour either.

### Selection beats ordering, and Google cannot do it

A different format: *pass through any four of these eight, your choice.* Same
pool, same cached matrix, and the player now picks the set as well as the
sequence.

| pick k of 8 | choices | wrong pick, median | wrong pick, worst |
| --- | --- | --- | --- |
| 2 | 28 | +25.5% | +85.1% |
| 3 | 56 | +45.5% | +84.9% |
| **4** | 70 | **+31.3%** | **+60.8%** |
| 5 | 56 | +32.8% | +52.0% |
| 6 | 28 | +19.8% | +27.2% |
| 7 | 8 | +10.6% | +13.0% |

Choosing the wrong four costs **+31.3%** where mis-ordering the right four costs
+21.9%. Selection is the larger decision, and it decays past five only because
picking six of eight barely leaves anything to choose.

The best four are **Paris, Amsterdam, Munich, Vienna** — the set that drops
Copenhagen and Rome, the two cities furthest off the axis. That is a judgement
about the shape of the continent, which is exactly the knowledge the game is
supposed to reward.

It also answers a problem the ordering result alone does not. Ordering a fixed
set is a travelling-salesman problem, and **Google Maps solves those** — its
waypoint optimiser handles up to ten stops, and since the free-flow order is the
traffic order on 233 of 247 races, its answer would be ours. Ordering by itself
does not clear the second-browser-tab bar.

Subset selection is not a feature Google offers. Combining them — pick four of
eight, then sequence them — is the first race format measured that a second
browser tab does not simply solve.

### The catch: checkpoint count drags run length with it

| checkpoints | 2 | 4 | 6 | 8 |
| --- | --- | --- | --- | --- |
| optimal run | 44.6 h | 56.4 h | 66.1 h | 74.3 h |

Every checkpoint added to a continental race costs about five hours. The
ordering sweet spot at four to five therefore lands on a **56–62 hour race**,
which is a lot to ask of a player.

The two are only coupled through geography, though. Checkpoints spaced across a
continent add five hours each; checkpoints spaced across France would add far
less. **Whether a regional race can hold four-to-five-checkpoint ordering
difficulty inside eight to twelve hours is the next measurement**, and it is the
one that decides whether the shippable race is continental or regional.

---

## Old section: enforcement as originally framed

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
