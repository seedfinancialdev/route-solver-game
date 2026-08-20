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
overnight fallback answers).

Those all plug into what's designed here without changing its shape. Building
any of them is not blocked on this spec being "finished" in some larger
sense — it's finished when the loop itself is sound.

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

## Module composition

Heat, fatigue, fuel, tires, weather: each registers its own accumulators
and interrupt conditions with the step function rather than being
hardcoded into it. The step function has no built-in knowledge of any
specific system — it only knows how to advance whatever modules are
currently registered and check their thresholds. This is what makes
practice mode's per-system toggles free instead of requiring a second,
simplified engine: an unregistered module simply never fires.

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

## Determinism as a feature, not just an implementation detail

Because the step function is pure and given-state deterministic, a full run
reduces to just its inputs — the route chosen, and when each command was
issued. Recording that (kilobytes, not video) makes a run **replayable**:
anyone can re-run the identical simulation from the same inputs and get the
identical result. This is not a new subsystem to build — it is a direct
consequence of the architecture above, and it pays for itself several ways:

- **Leaderboard integrity.** A claimed record is a replayable proof, not a
  trusted number in a database — the server (or anyone) can re-simulate the
  input log and verify it produces the claimed result.
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
