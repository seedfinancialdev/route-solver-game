---
name: perf-profile
description: Use after changing anything under web/, after any raster or cartography rebuild, or when asked whether the game has got heavier. Audits what a player downloads and finds assets shipped but never loaded.
---

# perf-profile

    npm run perf

Walks outward from `web/index.html`, following references transitively, and
splits everything in `web/` into eager (reachable from the entry point),
deferred (reached only through a manifest) and orphaned (reachable from
nothing). Then checks totals against `web/perf-budget.json`.

## Reading a failure

**"shipped but reachable from nothing"** — a file every visitor downloads on
deploy and the game never opens. Either wire it up or delete it along with the
pipeline stage that builds it. Add it to `knownOrphans` only as a deliberate
decision to keep shipping dead weight, with a reason.

**"over budget"** — decide whether the growth is worth it. If it is, edit
`web/perf-budget.json` in the same commit as the change that caused it, so the
move is reviewable. Never raise a budget just to get a green run.

## Known state

The eager payload is about 6.5 MB across 9 files (`terrain-detail.webp` and
`data.json` are the largest). `forest-detail.webp` (9.7 MB) and `forest.webp`
(1.7 MB) are currently orphaned — shipped, but unreachable from
`web/index.html` — not part of the eager payload. The budget records the
eager measurement rather than endorsing it — the tool's job is catching
growth.

## Scope

Static analysis only: no browser, no frame timing. It catches payload and
draw-loop-input regressions, which is where growth has actually come from. If
the map starts feeling slow while these numbers stay flat, that is the signal
to add real frame measurement.
