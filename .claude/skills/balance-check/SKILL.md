---
name: balance-check
description: Use when the road graph, the cost model, or the puzzle set has changed — after npm run data:graph or data:puzzles, before merging any data change, or when asked whether the game is still difficult. Verifies the shortest road still loses.
---

# balance-check

The game's premise is that the shortest route is the fastest only 27% of the
time, and that a player who always takes the shortest road loses. That is a
measured property of the current graph, not a design intention, and it stops
being true silently.

## Run it

    npm run balance             # seconds — the shipped set plus a bot sample
    npm run balance -- --sweep  # also the multiplier cliff; needs the calibrate:hos cache

## Reading a failure

**"the shortest road wins outright on N puzzles"** — the most serious result.
Those pairs are not puzzles: a player wins with zero judgement. Fix by
reselecting (`npm run data:puzzles`), never by lowering the budget multiplier.
docs/SPEC.md:226-233 measured patching budgets in place as leaving 8.5% of a
set broken.

**"margin under the 0.02 minimum"** — the multiplier has drifted too close to
where the shortest road starts winning. Lower it and reselect.

**"win rate has moved more than 3 points"** — a warning. If the move is real
and intended, regenerate the table with `--sweep` and paste it at
docs/SPEC.md:213. Never let a script write that table: the prose around it
carries reasoning that cannot be regenerated.

## The rule that matters

A graph or cost-model change forces puzzle *reselection*. There is no case
where patching an existing set's budgets is correct. See [[rebuild-data]].
