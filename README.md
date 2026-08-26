# Route

**Racing manager married to GeoGuessr.** Mastering route navigation the way a
real Cannonball record run actually works — departure timing, enforcement
geography, fuel and weather and mechanical calls, and what it costs when one
of them goes wrong. Not the driving: there is no AI driver and no crew chief,
you plan the run and you drive it. Full design:
[`docs/superpowers/specs/2026-08-20-design-intent.md`](docs/superpowers/specs/2026-08-20-design-intent.md)
— the authoritative spec, and every later document is audited against it.

That document supersedes the "remote orchestrator directing an AI driver
through a War Room" framing this README used to lead with, from
[`2026-08-20-core-gameplay-loop-design.md`](docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md).
That framing, and the architecture-first build order that came with it, are
both explicitly rejected in design-intent.md's "What this replaces" — kept
only so the rejected ideas don't come back by accident.

This replaces the previous shipped game — a daily driving-hours route puzzle
— and a never-shipped canvas map engine that was being built as its
replacement. Both are retired under `legacy/`: still buildable, playable, and
worth reusing pieces of, but not the direction anything here is building
toward. See `legacy/README.md`.

## Where things actually are

```
atlas/        the current playable prototype. A garage (curated cars, priced
              builds against a performance-points cap) and one race — pick
              checkpoints, choose a departure hour, drag a leg to reroute it
              — resolved server-side against the real road graph. Start here:
              `npm run atlas`. See "What's built" below for how much of the
              intended loop this actually covers today.
core-loop/    a Slice-1 architecture proof: a pure step function, module
              registration, bot-drivability, deterministic replay — proven
              against a throwaway, invented module with no game-design
              meaning. Built to prove
              2026-08-20-core-gameplay-loop-design.md's build order, which
              design-intent.md later rejected. Not on the critical path
              today; its proven patterns (deterministic replay, bot-drivable
              policies) are real assets a future slice can still reuse.
data/         real European cities, roads, and driving-hours-aware routing —
              generated once by scripts/, reused by atlas/, core-loop/, and
              (still) by legacy/. Direction-agnostic; nothing here changes
              with the reset.
scripts/      the data-generation and measurement pipeline. 00-03 and 06
              build data/; 16-28 build and gate atlas/'s race content
              (the checkpoint matrix, and the fuel/enforcement/traffic/
              vehicle gates in docs/superpowers/specs/2026-08-23-system-
              coupling-findings.md); 05, 07-11 build legacy/web/ specifically
              — still live so the legacy build stays regenerable.
play/         terminal playtest, bot player models, and the puzzle-balance
              tooling — built for the legacy game's specific rules, but the
              measurement technique (simulate a bot, sweep, verify the trap
              holds) is what scripts/17-28's gates generalize, not something
              thrown out.
legacy/       the previous shipped game and the canvas engine prototype that
              preceded core-loop. Retired, not deleted — still builds and
              plays. See legacy/README.md.
docs/superpowers/  design specs and plans. Start at
              specs/2026-08-20-design-intent.md. The most recent and most
              load-bearing are specs/2026-08-23-run-criteria.md and
              specs/2026-08-23-system-coupling-findings.md, which measured
              which systems actually change a race's outcome.
```

## What's built, and what the design still calls for

The playable slice is `atlas/`: one race (Barcelona → Istanbul, pick 4 of 8
checkpoints), a garage of curated cars, and server-authoritative route
resolution with drag-to-reroute. Per
[`2026-08-23-system-coupling-findings.md`](docs/superpowers/specs/2026-08-23-system-coupling-findings.md),
checkpoint selection and ordering are currently the *only* systems measured
to change which plan wins — departure hour, car choice, and fuel each change
your final time but not which plan is correct.

Missing against design-intent.md's own Plan → Execute → Debrief loop:

- **Execute** doesn't exist yet. Resolve returns a final result instantly;
  there is no running clock and no in-the-moment risk decision.
- **Debrief** doesn't exist. The result panel is a time, a medal, and a leg
  table — no loss attribution, no teaching, which design-intent.md calls the
  most important screen in the game.
- **One race, hardcoded to one day.** No daily tier, no persistence, no
  leaderboard — a result vanishes on refresh.

## Running things today

```sh
npm install
npm test                 # core-loop, data-pipeline, and balance tests
npm run atlas:data        # build atlas/cities.geojson + garage.json
npm run atlas:garage       # (re)build the garage from data/cars
npm run atlas              # serve atlas/ at http://localhost:8140, with /resolve
```

`npm run core-loop:play -- --bot` still runs the Slice-1 proof end to end,
human or bot. `npm run doctor` and `npm run balance` check the `data/`
pipeline and the legacy puzzle set respectively; `npm run perf` and
`npm run serve` target `legacy/web/` specifically (see their skills).

## What's next

Per design-intent.md's own build sequence — not the Slice 2-4 / module
backlog filed before the pivot (GitHub issues #5-#18, being reconciled
against this document):

1. **A working evidence surface.** Verify (or port) the cartographic
   discipline in `legacy/docs/CARTOGRAPHY.md` onto atlas/'s map — road
   character, alternative corridors, and risk exposure all need to read at
   plan time, not just look right.
2. **Execute and Debrief, even minimal.** The loop isn't a game without
   them — see "What's built" above.
3. **A second race, or a daily tier**, so "one race, one day" stops being
   literally true.
4. **Weather and incidents** — the two systems
   system-coupling-findings.md flags as the highest-value unbuilt ones,
   since everything else measured is either inert or reinforces whichever
   road was already fastest.

## Why legacy was retired

Both `legacy/` occupants were themselves the *previous* answer to "what is
this game" — a Cannonball-flavored driving-hours puzzle, then a from-scratch
visual rendering push toward replacing its map — and neither one is the
direction design-intent.md sets. Leaving them live in `web/` and
`docs/SPEC.md` at the repo root, next to a brand new redesign, was making it
look like three different games were all in progress at once, because they
were. This reset doesn't change what's buildable — everything in `legacy/`
still runs — it just stops the repo's top level from claiming to be three
things it isn't anymore.
