# The player experience: plan, race, debrief

2026-08-22. The loop as a player meets it, end to end.

Written because Execute was the gap. `2026-08-20-core-gameplay-loop-design.md`
specifies Plan and Debrief in detail and Execute in about a sentence, and a
walkthrough exposed the same hole — everything the player *does* during a run
was unspecified.

---

## 1. Landing in a career run

The map, framed to hold the whole run. Two markers. **No route drawn.** Finding
one is the entire game; suggesting one gives it away.

Three numbers in the brief, and they are all real rather than tuned:

| | |
| --- | --- |
| **Distance** | measured on the road graph |
| **Baseline** | what a navigation app says — NY→LA is 42 h by phone |
| **Record** | what the run has actually been done in — ~28 h for the same pair |

Everything between baseline and record is the ladder. Anchoring it to a real
gap rather than a tuned one is what makes it legible: *you beat the phone by
14%* means something instantly.

---

## 2. Loadout, before any route

Range and drivers, because both constrain everything downstream. Aux tanks
convert stops into range, which is exactly what real teams do them for.

*Unsettled:* whether car choice is a real decision layer. The tradeoff that
would make it one is that the car carrying the most fuel is not the fastest,
and the fastest is the one that gets noticed.

---

## 3. Planning

**Departure time comes first**, because it changes what the roads are worth.
The strategy it should support, and this is the test of whether the screen
works: *leaving an urban start at night, or timing a rural start so the first
metro is cleared at 03:00.*

Which means the plan needs a **time axis, not just a total**. "Madrid at 07:40"
is the fact that makes a departure time decidable, and a single projected
duration cannot express it.

### Pins are corrections, not commands

The route is built by dropping pins — fuel, driver swap, spotter, branch —
rather than tracing roads. Clicking junctions is unplayable.

But if the router fills between pins using the game's full cost model, then
placing pins in the right spots *is* the solution and the computer has done the
interesting part.

So: **the in-game router is deliberately naive.** Fastest by pure travel time,
ignoring risk, fuel, traffic and time of day. It is the phone. It gives the same
answer the second browser tab would give.

Pins are then how the player corrects it with what it cannot see. A pin is not
"solve this leg for me", it is "you do not know about this". That keeps the
router from being an oracle, and it turns the copy-the-phone problem into the
interface itself.

### The map answers back

Reachable range from the last fill. Whether any leg runs dry. Where the stops
land. Projected arrival at each point.

---

## 4. The race

The clock starts and never stops. The player is not driving — this is not a
driving sim — so the role is strategist, not driver.

### The dial: how hard to push

One control that matters continuously, and it is **relative to the posted
limit**, which must be on screen at all times.

Thirty over in a 50 and thirty over in a 70 are not the same situation, and
thirty over through a residential street is a different category again. So
risk scales **non-linearly with the limit and the road class**, not with raw
speed. The graph carries both per edge, so the model can key off them directly.

This is also the first thing that makes residential roads matter, which is why
they are in the graph at all.

### Events, not a progress bar

- **Branch pins** come due and must be committed.
- **Spotters** report what is ahead. Live conditions, so the game can act on it.
- **Fuel stops are events, not deductions.** Arriving asks questions: fill or
  splash-and-dash, is the services shut at 03:00, does the driver swap happen
  here or cost a separate stop. This is where a lot of real time leaks.
- **Falling behind** forces the question of whether to buy the time back with
  risk.

### Re-planning is free; the past is not

You can change where you are going. You cannot un-drive Ohio — distance, fuel
and attention already spent are sunk. That is what stops adaptation being a
retry loop, and it is realistic rather than an imposed rule.

---

## 5. Debrief

The most underrated screen in the game, and the one that does the teaching.

Time against the baseline, the record, and the player's own previous attempt.

Then **loss attribution, leg by leg**: *you planned this stretch at 90 and drove
it at 71* — with a photograph of what the road actually looks like. Villages, no
overtaking, a limit that could not be read off a line on a map.

That closes the loop. The player planned on an abstraction; the debrief shows
the reality behind it; the next reading is better. Twenty runs in they know what
a Spanish A-road looks like without being shown.

It should also hand over something durable: *this jurisdiction punishes hard,
that corridor is a trap at 08:00.* Knowledge that compounds across runs is what
`2026-08-20-design-intent.md` says the game is for.

---

## Recon and spotters are different things

Conflating them produced an incoherent mechanic, so the distinction is recorded.

**Recon — training, no in-run effect.** Look at real imagery of a road and learn
what that kind of road looks like. It belongs in planning and debrief.

The reasoning that fixes it: the game is *not* uncertain. The simulation knows
every road's speed exactly — whatever value it holds, inferred or not, IS the
truth of that world. What is uncertain is the **player's** reading of a map that
shows classes and weights rather than numbers. Recon resolves that, and it
transfers: being told "this road is 65" helps once; seeing what a 65 looks like
helps on every road afterwards.

An earlier version had recon resolving the *game's* uncertainty about inferred
speeds. That is incoherent — the player would end up knowing something truer
than the model, which the model then cannot act on.

**Spotters — information, real in-run effect.** Buy visibility on live
conditions ahead. Enforcement and traffic are modelled, so what they report is
something the simulation can act on.

The hard constraint under both: **the game can only reward knowledge about
things it models.** Same line as only promising what can be imported and
refreshed.

---

## Confidence

**Decided:** no suggested route; the baseline-to-record ladder; pins as the
planning verb; the naive router; clock never stops; re-plan the future not the
past; debrief as the teaching moment; recon versus spotters.

**Weakest:** Execute. Most of section 4 is a proposal rather than a settled
design, and it is the part with the least evidence behind it.

**The thing that makes all of it theoretical:** as of today **no system is
route-coupled**. Measured on the shipped puzzle set, the naive fastest route was
identical to the game-optimal route 100% of the time, because the only system
implemented scaled with time alone and a uniform tax cannot move an argmin.
Until at least two systems bite, the ladder above the baseline does not exist
and the strategist has no levers. Fuel is the first candidate.

---

## Open

- Whether car choice is a decision layer or a cosmetic one.
- What a spotter costs, and whether they are limited.
- Whether the photo-at-checkpoint idea earns its place. It is genuine — rally
  teams do it — but it is an observation puzzle, not road reading, and it
  collides with the continuous clock unless the stop is bounded.
- Imagery source. Google Street View has the coverage and a per-load bill that
  has nearly killed GeoGuessr twice; Mapillary is free with patchier coverage.
