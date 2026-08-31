# Core gameplay loop: orchestration over driving

Design, 2026-08-20. Not implementation-ready on its own — this is the
foundational sub-project a much larger direction decomposes into. Everything
here is scoped to one question: what is the shared loop that practice,
career, and multiplayer modes each package differently?

## Where this comes from

The shipped game (`README.md`, `docs/SPEC.md`) is a daily route-budgeting
puzzle: pick a chain of roads, city to city, under a driving-hours budget,
where the shortest road is a trap more often than not and a road's drawn
weight is your only evidence for how fast it runs. Its whole ethos is
**judgement, not measurement** — no randomness anywhere in the core puzzle,
every outcome traceable to a real, fixed, measured number.

This spec is the first piece of a much larger direction that keeps that
ethos and rebuilds almost everything around it: the player stops driving and
becomes a remote orchestrator directing an AI driver through natural-language
commands, watching a "War Room" of live telemetry rather than a windshield.
Law enforcement, weather, mechanical limits, and driver fatigue all become
visible systems the player manages — deliberately away from car-culture/rally
framing (the current commit history's "Cannonball Racing," "rally crew"
language) toward something closer to remote command-and-control.

## Scope

**In scope:** the shared simulation architecture and the Plan → Execute →
Debrief interaction shape every mode sits on top of.

**Explicitly out of scope, each its own follow-on spec:** the Heat/law
enforcement accumulator's exact formula and penalty tiers; recon
imagery/fidelity progression tiers; the XP/progression economy; weather and
traffic data sourcing; mechanical failure thresholds (brakes, tires, engine);
road-network density scaling (the current graph is deliberately sparse —
Delaunay+kNN candidates, edges trimmed past 420 km — built for one
shortest-vs-optimal trap per city pair, not for the multiple genuinely
distinct strategic paths — highway vs. backroad, storm detour, burned-corridor
reroute — this design assumes exist); the practice-mode system-toggle UI;
multiplayer server infrastructure (accounts, live sync, push notifications,
overnight fallback answers); the exact route-generation grading criteria and
per-road-class record-calibration parameters; the star-tier threshold values;
a US dataset (a real, deferred future project — see Route generation and
grading, below — not assumed here).

Those all plug into what's designed here without changing its shape. Building
any of them is not blocked on this spec being "finished" in some larger
sense — it's finished when the loop itself is sound.

## Build order: greenfield, not retrofit

This gets built the way a professional team would build it new — designed
from what the game actually needs, not from what the existing repo already
has. The existing map data, road graph, and driving-hours code are real
assets and will get pulled in, but only where they earn a place once a
specific piece is actually being built — never as the starting point a new
system gets bent to fit.

**The first slice proves the architecture, not any game system.** A single,
entirely invented, throwaway module — no game-design meaning, an accumulator
over a made-up sequence of legs, a threshold, a pause, two arbitrary
player-facing choices, a resume. The only thing under test is the plumbing:
does the step function stay genuinely ignorant of what it's advancing, does
pause-and-resume preserve exact state, does a bot policy work as a drop-in
for a human choice, does recording inputs and replaying them reproduce the
identical result. No UI, no real content, nothing from the existing codebase
anywhere near it. Only once that's proven does a real module — fatigue,
Heat, whatever comes first — get designed on its own merits and dropped into
an architecture already known to work.

## The three modes, and why the loop has to be mode-agnostic

- **Practice** (10–30 min): short routes, player chooses which systems run —
  full rule set earns full XP, a lighter run earns less. Exists so a player
  can build skill without committing to a full run.
- **Career** (45–60 min): the core mode. Full rule set, one sitting.
- **Multiplayer** (up to 24h, real-time, async): everyone starts at the
  actual scheduled time, races in real wall-clock time, first to finish wins.
  No direct interaction between racers — same race, run in parallel, pure
  time competition. Needs default/fallback answers for stretches the player
  isn't available (overnight, etc.).

These are not three games sharing vocabulary. They're one simulation played
at three different time-compressions and stakes levels. A design that only
worked for one of them would need rebuilding for the others — the point of
this spec is a shape that doesn't.

## Architecture: one step function, two drivers

The core is a single, pure, deterministic simulation step function — no
browser-only assumptions, portable by construction. This is not a new
pattern for this codebase: `hosCost` (`scripts/lib/graph.mjs:57-61`) is
already exactly this shape — pure function, accumulated state in, updated
state plus a consequence out, no I/O, no randomness, unit-tested. The new
step function generalizes that pattern from one accumulator (driving-hours)
to an arbitrary set of pluggable ones (see Module composition, below).

It's driven two different ways depending on mode, without the function
itself changing:

- **Solo (practice/career):** called repeatedly, as fast as the machine can
  go, until an interrupt condition fires or the current leg completes.
- **Multiplayer:** the identical function, called on a real wall-clock
  timer, **server-authoritative**. The server is the source of truth for
  race results; a client renders a view onto it, it does not run a
  competing simulation whose result could disagree. This is standard
  practice for any game with a real leaderboard (the same reason RTS
  lockstep networking sends only inputs over the wire, never trusts a
  client's local outcome) — it is the only way "first to finish" means
  anything against real opponents.

This is why the step function has to be written portable from day one: the
same code has to run identically in the browser (solo modes) and on a
server (multiplayer), or the two will drift apart the first time either one
is patched.

## The loop: Plan → Execute → Debrief

**Plan.** Macro-routing (a highway-vs-backroad, weather-aware corridor
choice — an extension of the existing pace-tier vocabulary, not a
replacement of it) and micro-routing (recon-informed leg selection), plus
resource strategy wherever fuel/tires are active systems. In practice mode,
this is also where the player picks which systems run this session.

**Execute.** The route is a sequence of discrete legs — the same shape as
the existing graph's city-to-city hops (`scripts/lib/graph.mjs:6-15`,
`dijkstra`/`hosDijkstra`). Within a leg, the step function runs until either
it resolves cleanly — identical to how a hop resolves in the shipped game
today, when no optional system is active — or an active module's accumulator
crosses its threshold, which pauses execution and hands control to the
player: a recon crisis, a Heat/pace decision, a pit-stop call. The player
responds (a command, a route change), execution resumes from that exact
state. No system active means no possible interrupt — a leg with everything
switched off behaves exactly like a hop in the shipped game does now.

**Debrief.** Results compile into Pace Notes, extending the existing reveal
screen (both routes driven side by side, `docs/SPEC.md`'s described replay)
rather than replacing it.

## Route generation and grading

> **Flagged for a fresh pass.** This section was derived by generalizing
> `02-puzzles.mjs`'s existing criteria upward — reuse-first, not
> design-first. Those specific numbers (trap ratio, bust ratio, dead-end
> rate) were invented for a different problem: whether choosing between a
> handful of roads is a fair single decision under a budget. What actually
> makes a good multi-leg outlaw route is a genuinely open question — real
> strategic variety at multiple points, a real mix of high-Heat and safe
> stretches, matching the scale of an actual cross-country run — and hasn't
> been asked fresh yet. Treat what follows as a strawman worth comparing
> against when this slice is actually reached, not a settled decision.

Career and multiplayer content is not hand-picked or randomly assigned from
a fixed pool — it's generated, then graded, and only what clears a bar
becomes a real route. The existing `scripts/02-puzzles.mjs`
already does exactly this today, at the scale of one hop-chain — generate
every candidate city pair, simulate a bot (`roadReader`) against it, keep
only pairs where the shortest route is a genuine trap
(`MIN_SHORTEST_PENALTY` ≥ 1.12), losing is a near-miss (`MAX_WORST_RATIO`
≤ 1.45), dead-ends are rare (`MAX_STUCK_RATE` ≤ 0.15). Generalizing this
from a single hop-chain to a full multi-leg route is a scale change to an
existing, working pattern, not a new architecture.

Grading runs on two axes:

- **Shape and scale** — does a candidate route feel like a real cross-country
  run (distance, leg count, regional mix), measured against the real
  Cannonball route's own statistics as a reference.
- **Difficulty and fairness** — the same style of trap/bust/dead-end bounds
  already in use today, scaled to a full route, verified the same way: bot
  simulation, not hand-tuning.

Practice routes fall out of the same pipeline at shorter length — either
literal subsections of a graded longer route, or independently generated
short routes matching the statistical character of a typical subsection.
One generation-and-grading pipeline, three output grains, not three separate
content systems.

**Europe-only for now.** A US dataset — recreating the real route this game
pays homage to — is real, deferred future work. The pipeline this project
already built (`scripts/00-cities.mjs` through `scripts/09-real-osm-forests.mjs`,
the whole `scripts/lib/` toolkit) is written generically enough to point at a
different region's source data. But generating and curating it is its own
project on the scale of everything already built for Europe — not something
this spec assumes happens alongside it.

**A route's record time is not a flat ratio applied to its legal-optimal
time.** Two reasons a single global multiplier would be the wrong model:

1. Real record-setting isn't achieved by ignoring risk — it's a policy under
   the same enforcement and fatigue tradeoffs a player faces. So a route's
   record should come from running a simulated optimal, risk-aware policy
   (the same `roadReader`-style approach, extended to read the new module
   system) through it, not from a static formula.
2. How much a driver can beat the legal limit isn't uniform across a route —
   it's dominated by road design. A straight, well-engineered motorway has
   far more headroom between "legal" and "physically achievable" than a
   technical secondary road, where the limit is often already close to what
   the road can physically support. The game's existing pace-tier data
   already measures this, road class by road class — the same signal, reused
   for a new purpose. Record calibration works **per road class**, not as
   one number for the whole trip.

The real, documented Cannonball record (Ed Bolian's widely-publicized
cross-country run) is used to **sanity-check** those per-road-class
parameters, not to calibrate them outright — it's one real, verified data
point, useful for confirming the model lands in a plausible range, not
sufficient on its own the way the existing puzzle criteria were calibrated
(a sweep across thousands of simulated candidates, not one anchor). Its
precise, sourced figures, and the exact per-class parameters they inform, are
follow-on work.

## Module composition

Heat, fatigue, fuel, tires, weather: each registers its own accumulators
and interrupt conditions with the step function rather than being
hardcoded into it. The step function has no built-in knowledge of any
specific system — it only knows how to advance whatever modules are
currently registered and check their thresholds. This is what makes
practice mode's per-system toggles free instead of requiring a second,
simplified engine: an unregistered module simply never fires.

> **Flagged for a fresh pass, same as route grading above.** What follows
> started from `hosCost`'s existing accumulator shape and patched its
> consequence once the mandatory-break framing broke — reuse-first again,
> not design-first. It landed somewhere defensible, but the actual question
> — what should fatigue mean when the player is orchestrating a driver
> remotely rather than being one — hasn't been asked from a blank page.
> Whether a single scalar accumulator is even the right shape (versus, say,
> per-driver state in a real multi-driver crew system) is still open. Revisit
> fresh when this slice is reached.

**Fatigue's accumulator is reused from the existing HOS mechanic; its
consequence is not.** `hosCost` (`scripts/lib/graph.mjs:57-61`) models EU
professional-driver hours law — 4.5 hours of continuous driving forces a
45-minute break, no player choice. That framing is a real-world commercial
compliance rule; it has no reason to bind a crew already ignoring speed
limits and evading enforcement, and it contradicts the actual history of
this kind of driving — real record-run crews carry multiple drivers
specifically so the car never has to stop. So the accumulator (time since
rest) carries forward unchanged, but the threshold no longer forces
anything. Instead, rising fatigue **degrades what the player can see and
how fast they can act on it**: the driver's own reported telemetry gets
noisier and more delayed, and the response window on interrupts (a recon
crisis, a Heat decision) shrinks. Resting, or swapping to a second driver
mid-route — itself a real Cannonball-era tactic, and a natural extension of
the pit-stop concept — clears it. Never forced. This is a stronger fit for
the design's own "no RNG, every failure is attributable to a choice"
principle than the mechanic it replaces: the original gave the player no
choice at all; this makes pushing a tired driver a visible, continuous risk
the player owns, not a rule the game enforces on them.

Fatigue is also a useful first module for a second reason: because it feeds
*other* modules' output quality (degraded telemetry) rather than only
gating itself, it's the natural proving ground for whether the module
system genuinely composes — modules reading each other's state, not just
running independent, unrelated accumulators in parallel.

Each module's interface must also accept a policy function in place of a
human — i.e., be drivable by a bot, not only by UI interaction. This
codebase already has the infrastructure this pattern needs:
`play/bots.mjs`'s `roadReader` and `shortestRouter`, and
`play/calibrate-hos.mjs`'s automated multiplier sweep, are exactly this
approach already applied to the current game's one accumulator. Retrofitting
bot-drivability after modules are built human-interaction-first is much
harder than building it in from the start, and without it, Heat/fatigue/fuel
thresholds can only ever be tuned by feel — never swept and calibrated the
way the current game's 1.11 budget multiplier was.

## Scoring: a star ladder, not a pass/fail budget

The shipped game's score is a single binary threshold —
`budget = optimal × 1.11` (`docs/SPEC.md:209`), hours-to-spare against it.
That fits a fiction where the player is a legal driver clearing a compliance
bar. It doesn't fit record-chasing.

Replace the threshold with a tiered ladder — Bronze / Silver / Gold /
Record — closer to a time-trial grading than a pass/fail. The underlying
math doesn't change, only the count: still margin against a threshold, just
several thresholds instead of one. "Record" is a live ceiling — whoever
currently holds the best verified time on that route — not a fixed
design-time number.

This is the direct payoff of route grading, above: a route's Bronze/Silver/
Gold thresholds come from the same bot-simulated optimal-policy performance
already used to decide whether the route is worth keeping at all, not
invented as a separate step. What happens for whoever currently holds a
route's record — the actual reward, the recognition — is deferred to its
own spec; the mechanism that makes a record claim trustworthy is not (see
below).

## Determinism as a feature, not just an implementation detail

Because the step function is pure and given-state deterministic, a full run
reduces to just its inputs — the route chosen, and when each command was
issued. Recording that (kilobytes, not video) makes a run **replayable**:
anyone can re-run the identical simulation from the same inputs and get the
identical result. This is not a new subsystem to build — it is a direct
consequence of the architecture above, and it pays for itself several ways:

- **Leaderboard integrity.** A claimed record — the top of the star ladder
  above — is a replayable proof, not a trusted number in a database — the
  server (or anyone) can re-simulate the input log and verify it produces
  the claimed result.
- **Spectating and sharing.** Watching a multiplayer race live, or watching
  your own run back to see exactly where a call went wrong, falls out of
  the same recording for free.
- **Fair daily conditions.** Weather and traffic should be a deterministic
  function of a per-day seed, not per-player randomness — the same
  principle the shipped game already lives by (`data/puzzles.json`'s
  `generated` field: everyone gets the identical daily puzzle). Every
  player facing the identical storm on the identical day is what makes "who
  routed around it best" a real, comparable answer instead of noise, and it
  keeps the "no RNG" ethos intact at the world level, not only the
  mechanical one.

## Engineering discipline this design commits to

- **Session state is one serializable snapshot** (current leg, every active
  module's accumulator values, elapsed real time) — not state scattered
  across UI components. Given 45–60 minute career runs and 24-hour
  multiplayer races, someone will close the tab or lose connection; if state
  is a single clean object from the start, save/resume and crash recovery
  are close to free instead of a separate feature.
- **Modules must not rely on a single visual channel for load-bearing
  information.** `docs/CARTOGRAPHY.md`'s existing rule — pace tiers never
  rely on hue alone, always width too — extends to recon/crisis imagery:
  a parallel textual cue travels alongside any picture the player has to
  read, not a picture alone.

## What this spec deliberately does not resolve

These are real, acknowledged gaps — not oversights — each waiting on its own
spec once this loop is validated:

- The exact shape of an "interrupt" as a UI moment (what a Heat decision or
  a recon crisis actually looks like on screen).
- Whether/how the road network needs to grow in density before highway/
  backroad/detour choices are meaningfully distinct paths rather than a
  single existing edge.
- Server infrastructure specifics for multiplayer (this spec only commits to
  "the step function must be portable enough to run there," not how
  accounts, matchmaking, or notification delivery work).
- The progression/XP economy's actual numbers.
- The procedural route-generation algorithm itself, its exact shape/scale
  and difficulty grading thresholds, and the per-road-class record-headroom
  parameters (including the real Cannonball record's precise, sourced
  figures once they're needed for calibration).
- Star-tier threshold values, and what (if anything) is awarded for holding
  a route's record.
- The US dataset — real, wanted, explicitly not started.
