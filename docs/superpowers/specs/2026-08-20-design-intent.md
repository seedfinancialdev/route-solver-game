# Design intent: what this game is

Design intent, 2026-08-20.

This document exists because the intent kept living in one person's head and
being re-explained. It records what the game **is** and what it **is not**, so
neither has to be argued again from scratch.

**Scope: intent and pillars only.** Not system specifications, not numbers, not
architecture. Every system document that follows derives from this one and must
be auditable against it. Where this document and a later one disagree, this one
is wrong or the later one is — say which, in writing, and fix it here.

It supersedes the framing of `2026-08-20-core-gameplay-loop-design.md`. That
document's engineering commitments largely survive; its framing of the game does
not. See **What this replaces** at the end, which exists specifically so the
rejected ideas do not come back.

---

## The pitch

**Racing manager married to GeoGuessr.**

Mastering route navigation in the context of how a real Cannonball record run
actually works — departure timing, enforcement geography, fuel and weather and
mechanical calls, and what it costs when one of them goes wrong.

Not the driving.

---

## Pillars

These are load-bearing. Changing one is a change to what the game is, not a
tuning decision.

### 1. Reality is the design authority

**The game never invents a number it could source.**

Speed limits, enforcement behaviour, traffic patterns by hour, weather
climatology, mechanical failure modes, the consequences of being stopped — all
of these are real, documented, and researchable. Design's job is *selection and
presentation*, never invention.

This is auditable, and should be audited: hold any system to the question
"where did this number come from?" A system that answers "it felt right" has
failed the pillar.

Corollary: the fiction generalises. Point-to-point record running is a real,
global practice, and the game inherits its constraints rather than inventing a
sport.

### 2. Mastery is a transferable reading skill

Two layers:

- **Floor — Cannonball craft.** The method: departure timing so the metros are
  empty when you reach them, minimising the number of stops rather than the
  fuel burned, reading enforcement exposure, knowing when a plan is dead.
  Learnable in a handful of runs. Applies to any map.
- **Ceiling — road literacy.** Reading what a road's class, geometry, terrain,
  and a jurisdiction's engineering conventions tell you about how fast it
  actually runs. Takes dozens of runs. This is what separates competent from
  good.

**The ceiling is "can read any road network," not "has memorised Europe."**
GeoGuessr players do not memorise locations; they learn to read bollards, sign
fonts, vegetation and sun angle, and that generalises to places they have never
seen. Same here. Europe is the training set, not the subject.

This has a hard consequence for the debrief: it must teach **principles**, not
**facts**. "Secondary roads in mountainous terrain lose more to geometry than to
speed limit" travels to Colorado. "The A4 is fast" does not. Every line of
debrief copy is auditable against that test.

### 3. No randomness — every consequence is earned

No RNG anywhere in the core game. Inherited from the shipped game and
non-negotiable, because learnability is the entire product and dice destroy it.

Bad things must still happen — a Cannonball game where nothing goes wrong is not
a Cannonball game, and real runs are defined by what went wrong. The resolution:

> **Every bad thing that happens is a bill for a risk you took and could see.**

- Being stopped was never a coin flip. It is how far over you were, in which
  jurisdiction, on what road class, at what hour, for how long. Every input was
  a choice you made.
- A flat or a breakdown was never a coin flip. It is sustained speed, surface
  quality of the roads you picked, ambient temperature, distance since you last
  stopped, whether you skipped a check to save four minutes.
- A serious accident is the far tail of that same exposure, and must be strictly
  telegraphed. The player has to be able to see they are deep in the red and
  back off. Never a bolt from the blue.

Severity is scaled against **documented real outcomes**, not designer feel
(pillar 1). Run-ending outcomes exist because they exist in reality.

Accepted consequence: a perfect player never fails. That is correct and matches
the shipped game. Difficulty comes from the judgement being hard, not from dice.

When difficulty does need raising, **the lever is concealment, not randomness** —
uncertainty comes from what the player has not been shown, never from a roll. See
the information stance below, which starts transparent and treats concealment as a
dial to be tuned with data.

World conditions follow the same rule — a deterministic function of the day's
seed, identical for every player, exactly as `data/puzzles.json` already works.

### 4. The map is the evidence surface

The map is not how the game is displayed. It is **where the evidence lives**,
and evidence is the mechanic. The shipped game already proved this: "a road's
drawn weight is your only evidence for how fast it runs" is a cartographic
mechanic, not a simulation one. GeoGuessr without imagery is not a weaker
GeoGuessr; it is nothing.

The dependency runs in one direction and every build decision should respect it:

> **What the map can express → what the player can read → what decisions exist
> → which systems are worth building.**

A system whose state the map cannot express is a system the player cannot play.
See **The cartographic brief** below.

### 5. Region is data, never code

The world is the eventual scope. Europe is where the data was cheapest to build;
the United States is where the fantasy actually lives, and it is the second
region, not deferred future work.

Enforcement behaviour, speed limits, road-class taxonomy, units, borders, tolls,
fuel, driver-hours law: every one is a **region attribute**. Hardcoding a
European assumption is cheap today and catastrophic to retrofit.

---

## What "rebuild" means

The game is rebuilt, not extended: no part of the shipped game's design is assumed
to survive, including the daily puzzle's.

That is a statement about **design**, not about assets. The map engine, the data
pipeline, the cartographic discipline in `docs/CARTOGRAPHY.md`, and measured data
like `countrySpeed` are real assets and get pulled forward wherever they earn a
place against the pillars above — never as a starting point that a new system is
bent to fit.

---

## The player

**There is no fiction and no character.** GeoGuessr has none and loses nothing.

It is your run. You plan it and you drive it. There is no AI driver, no crew
chief, no persona between you and the road. Tone comes from the map and the
clock.

---

## The loop

### Plan

Where most of the game is. Corridor choice, departure hour, stop placement,
strategy envelope. A bad run is usually a bad plan, and you should be able to
tell before the halfway point.

### Execute

Live, and genuinely decision-rich — because you are the driver too. Do I slow
for this jurisdiction or take the exposure? Brave the weather or accept the
detour? Push to the next stop or take the safe one? Plus the incidents that
follow from those calls.

**Risk exposure is the unified currency of this phase.** Police, mechanical
wear, weather and fatigue are not four unrelated accumulators — they are four
faces of one thing the player continuously spends to buy time. This is what
makes "this corridor is faster but hotter" a real sentence, and it is what makes
the corridor evidence below pay off.

### Debrief

**The debrief is the teacher, not a results screen.** In GeoGuessr the reveal is
where one hundred percent of the learning happens. This is the most important
screen in the game and it gets designed first, not last.

It must teach principles (pillar 2), and it must show *where* the run was
decided, not merely what it cost.

---

## Content model: one world, varied endpoints

GeoGuessr has exactly one map — the Earth — and infinite content, because
variety comes from where you are dropped, not from generating new terrain.

Same here. **One deeply-modelled network; runs draw different start/end pairs
and departure times across the same ground.** You meet the same roads many times
and come to genuinely know them. Literacy accumulates and content does not run
out.

This is a deliberate rejection of continent-wide procedural generation, which
would mean rarely meeting the same road twice — under which the road-literacy
ceiling never forms at all.

## Two tiers

- **Daily — short.** Where literacy is built cheaply, through repetition.
- **Career — long.** Where it gets spent. The full run, the event.

Two session shapes, one skill, one set of systems.

## Information stance

**Start transparent. Hiding is a difficulty dial, tuned with data — not a launch
pillar.**

Real-world patterns are modelled *inside* the game, deterministically, from real
sources. The player is never sent out to a weather site or a traffic service.

The reasoning, recorded so it is not relitigated:

> **Research that compounds is a feature. Research that expires is homework.**

Learning that a jurisdiction polices hard is knowledge carried into every future
run. Looking up tomorrow's forecast is used once and discarded. Required
external lookup would also destroy determinism (and with it replay, verified
records, and fair leaderboards), remove the debrief's ability to teach — the
game cannot tell you that you misjudged something it does not model — and make
skill a function of tool access rather than judgement. It is also simply
unavailable across most of any map.

If live real-world conditions are wanted, the mechanism is a **snapshot**: fetch
once when the day's route is generated, freeze it into the puzzle, everyone
plays the identical frozen reality. Real *and* deterministic.

Because information starts transparent, **all of v1's difficulty must come from
the tradeoffs being genuinely hard.** Transparent information plus systems that
cannot swing an outcome is a solved shortest-path problem. See the evidence
below for how hard that bar is.

---

## The cartographic brief

First-class, not an appendix — pillar 4 makes this a design surface. Five
channels the map must express, derived from the pillars rather than from taste:

1. **Road character** — class, geometry, terrain. The literacy signal itself. If
   a mountain secondary reads the same as a plains trunk road, the ceiling skill
   is unlearnable.
2. **Alternative corridors** — visible and distinguishable at plan time. A
   corridor the player cannot see is not a choice.
3. **Time** — departure hour is a central skill, so the canvas must express
   *when*, not only *where*.
4. **Jurisdiction** — enforcement is regional; boundaries must read.
5. **Risk exposure** — the currency spent in Execute must be legible on the
   surface the player plans on.

**The test, and it is cheap to run on paper with real people:**

> Looking at the map alone, at plan time, can a player identify the distinct
> corridors and form a hypothesis about which is faster, and why?

**The failure mode to guard against is building the map to *look* right rather
than to *read* right.** That test is the guard.

`docs/CARTOGRAPHY.md` already encodes the right discipline — load-bearing versus
scenery, the pace tell frozen at a 2.8:1 width ratio, `npm run balance` as
arbiter, never hue alone. It is the closest thing this project has to captured
design intent and it should be the model for every document that follows.

---

## Evidence

Real measurements taken 2026-08-20. Nothing here is estimated.

### The graph supports strategic variety, but only at +20%

838 cities, 2,160 edges, median degree 5, edge speeds p10 53.9 / p50 70.0 / p90
85.0 km/h. Corridor diversity measured over 25 city pairs more than 1,800 km
apart, by iterative penalised Dijkstra, counting only corridors sharing under
65% of their distance with any already accepted:

| Time tolerance | Mean distinct corridors | Routes with only one option |
| --- | --- | --- |
| within +10% of optimal | 1.44 | **18 / 25** |
| within +20% | 4.00 | 2 / 25 |
| within +35% | 7.52 | 0 / 25 |

At tight tolerance the strategic layer does not exist — 72% of long routes have
exactly one sensible corridor. The variety is real but it lives at +20%. Which
produces a hard requirement:

> **The non-time systems must be able to swing an outcome by 20% or more, or the
> map's variety is unreachable and every player correctly takes the fastest road
> every time.**

That is the calibration bar for enforcement, traffic, weather and stops — known
before the systems are built rather than discovered after.

Second finding: **corridor character spread is uneven.** Bilbao→Gdańsk offers
71.8–82.7 km/h across its alternatives — genuinely different roads. Konya→Milan
offers 75.7–76.5 km/h — four corridors that are the same drive on different
asphalt. **Grade candidate routes on corridor character spread, not corridor
count**, because character is what the player can read off the map.

### The +20% bar is structural, and the daily tier is viable

Same method, run across shorter bands (25 pairs sampled per band):

| Route length | +10% | +20% | +35% | single-corridor at +20% |
| --- | --- | --- | --- | --- |
| 250-500 km | 1.84 | **2.76** | 3.60 | 2 / 25 |
| 500-900 km | 1.64 | **3.24** | 4.92 | 2 / 25 |
| 900-1400 km | 1.72 | **3.32** | 5.64 | 1 / 25 |
| 1800 km+ | 1.44 | **4.00** | 7.52 | 2 / 25 |

Two conclusions:

- **The daily tier has a real strategic layer.** Even at 250-500 km, 23 of 25
  routes carry two or more distinct corridors within +20%. Thinner than
  cross-continent runs, but genuinely present. The network does not need
  densifying before the daily tier is worth building.
- **The +20% requirement is structural, not an artifact of long routes.** At
  +10% the graph is barren at every scale, with roughly half of all routes
  offering a single corridor. The same calibration target therefore applies
  across the whole product, not per-tier.

*Caveat on all corridor figures: 25 pairs per band, and a heuristic 65% overlap
threshold. The direction is solid; treat the exact values as a first read.*

### Known finding: the canvas engine deletes the pace tell

Not a design decision — a defect, recorded here because it demonstrates pillar 4
concretely.

`web/map/cartography-layer.js:173-176` buckets each road by `edge.pace[0]`, the
tier of its **first segment**. Every road leaves a city slowly, so across all
2,160 edges the first-step tier distribution is 2,151 / 9 / 0. **99.6% of the
network lands in a single bucket** and the map draws every road as the same
class. The true mix across road stretches is 47.7% slow, 23.9% ordinary, 28.4%
motorway — entirely discarded.

The mapping is also inverted: `scripts/05-bundle.mjs:44` defines tier 2 as
fastest, the canvas treats 0 as motorway. So the bucket everything falls into
renders as heavy red arterial, while real motorways land in "primaries" and only
draw below 900 km zoom — meaning **at the continental overview, precisely where
a corridor decision is made, none of the motorway network is visible.**

The shipped SVG engine is correct: `web/engine.js:78` `roadRuns` splits an edge
into runs of one pace so the motorway stretches draw heavy and the slow ones
hairline. The data fully supports it. The canvas engine needs the port, not an
invention.

This is what pillar 4 protects against: from the systems side, enforcement could
have been modelled to three decimal places on a canvas unable to draw a
motorway.

### Assets that already satisfy the brief

- **Time** — the studio has a 24-hour solar clock and time-of-day themes.
  Departure hour already has a visual language.
- **Jurisdiction** — `countrySpeed` covers 41 countries with real limits by road
  type and sourced notes. Reality-authoritative under pillar 1, already built.

---

## What this replaces

Recorded so these do not return without a new argument.

| Rejected | Why |
| --- | --- |
| **AI driver directed by natural language** | No fiction, and the player drives. Natural language is expensive, ambiguous, and fights determinism. A verb set that reads naturally gets the fantasy for a fraction of the cost. |
| **The "War Room" of live telemetry** | Belongs to a drone-command game. The centrepiece is the planning surface, and live calls are the driver's, not a handler's. |
| **Architecture-first build order** | The old document's first slice proved plumbing while deferring every question that decides whether the game is good. Plumbing is a solved problem; the game is not. |
| **Continent-wide procedural route generation** | Rarely meeting the same road twice prevents the road-literacy ceiling from forming. One world, varied endpoints instead. |
| **Required out-of-game research** | Destroys determinism, replay, and verified records; removes the debrief's ability to teach; makes skill a function of tool access; and the data does not exist across most of a map. |
| **Fatigue as a forced-break compliance rule** | A commercial-driver regulation has no reason to bind this crew. Retained instead as risk exposure under pillar 3. |
| **A single pass/fail budget threshold** | Fits a compliance fiction, not record chasing. Superseded by a tiered result; exact tiers are follow-on work. |

**Retained from the old document**, on its own merits: a pure deterministic
simulation step function; bot-drivable policies as a first-class requirement,
which is the entire balance methodology and how the 20% bar gets tested; session
state as one serializable snapshot; deterministic daily conditions; and never
relying on a single visual channel for load-bearing information.

---

## Build sequence

Derived from pillar 4 — the map defines what can be read, which defines what
systems are worth building.

0. ~~Measure short-route corridor diversity.~~ **Done** — see the evidence
   above. The daily tier is viable and the +20% bar applies at every scale.
1. **Make the canvas a working evidence surface.** Port `roadRuns`, correct the
   inversion, then design the two missing channels — alternative corridors and
   risk exposure. Gate: the plan-time reading test above, run with real people.
2. **Build the minimum model that is actually a game** — one system that costs
   **time** (traffic by hour of day) and one that costs **risk** (enforcement by
   jurisdiction). Either alone is still an optimisation problem; both together
   is a tradeoff. Both already have data footholds. Bot-swept against the 20%
   bar.
3. **Wrap it in the cheapest thing that can be played repeatedly** — the daily
   tier.

Weather, mechanical wear, fatigue and fuel are all further expressions of the
same two currencies. They deepen the model; they do not create the game. They
are phase two and will be tuned far better against something playable.

---

## Open questions

Real gaps, not oversights. Each needs its own document.

- What "risk exposure" looks like as a visible quantity on the map, and whether
  it is one number or several.
- Which channel carries alternative corridors without burying the road-character
  signal that shares the same surface.
- The result ladder's shape and thresholds, and what a record is worth.
- Sourcing plan for enforcement consequence data by jurisdiction.
- Multiplayer, if any. Not assumed by this document.
