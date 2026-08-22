# Route

The active direction is **core-loop**: the player stops driving and becomes a
remote orchestrator directing an AI driver through natural-language commands,
watching a "War Room" of live telemetry rather than a windshield. Law
enforcement, weather, mechanical limits, and driver fatigue are visible
systems the player manages. Full design:
[`docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md`](docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md).

This replaces the previous shipped game — a daily driving-hours route puzzle
— and a never-shipped canvas map engine that was being built as its
replacement. Both are retired under `legacy/`: still buildable, playable, and
worth reusing pieces of, but not the direction anything here is building
toward. See `legacy/README.md`.

## Where things actually are

```
core-loop/    the new game's engine. Currently Slice 1 only: a pure step
              function, module registration, bot-drivability, deterministic
              replay — proven against a throwaway, invented module with no
              game-design meaning. No real game content yet; see below.
data/         real European cities, roads, and driving-hours-aware routing —
              generated once by scripts/, reused by core-loop and (still) by
              legacy/. Direction-agnostic; nothing here changes with the reset.
scripts/      the data-generation pipeline. 00-03 and 06 build data/ and are
              what core-loop's own route-generation work is expected to build
              on (see issue #8). 05, 07-11 build legacy/web/ specifically —
              still live so the legacy build stays regenerable, not part of
              core-loop.
play/         terminal playtest, bot player models, and the puzzle-balance
              tooling — built for the legacy game's specific rules, but the
              measurement technique (simulate a bot, sweep, verify the trap
              holds) is the thing core-loop's route grading is expected to
              generalize, not throw out.
legacy/       the previous shipped game and the canvas engine prototype that
              was meant to replace it. Retired, not deleted — still builds
              and plays. See legacy/README.md.
docs/superpowers/  the core-loop specs and plans. Start at
              specs/2026-08-20-core-gameplay-loop-design.md.
```

## Why the reset

Both `legacy/` occupants were themselves the *previous* answer to "what is
this game" — a Cannonball-flavored driving-hours puzzle, then a from-scratch
visual rendering push toward replacing its map — and neither one is what
core-loop is building. Leaving them live in `web/` and `docs/SPEC.md` at the
repo root, next to a brand new redesign, was making it look like three
different games were all in progress at once, because they were. This reset
doesn't change what's buildable — everything in `legacy/` still runs — it
just stops the repo's top level from claiming to be three things it isn't
anymore.

## Running core-loop today

```sh
npm install
npm test                          # core-loop, data-pipeline, and balance tests
npm run core-loop:play -- --bot   # terminal proof: drives the invented Slice-1
                                   # module end to end, human or bot
```

There is no UI yet — that's Slice 4 (issue #7), after real game modules
exist. `npm run doctor` and `npm run balance` still check the `data/`
pipeline and the legacy puzzle set respectively; `npm run perf` and
`npm run serve` now target `legacy/web/` specifically (see their skills).

## What's next

Slice 2 (issue #5): pick and freshly design the first real module — fatigue,
Heat, or something else — per the spec's "Module composition" section, then
build it against the architecture Slice 1 already proved. Full backlog:
issues #6–#18 on this repo.
