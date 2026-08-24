# Run criteria: what makes a race worth shipping

2026-08-23. Replaces `2026-08-22-run-criteria.md`, which gated on corridor
choice. Six systems have since been measured against "does it change the
answer" and corridor choice was not one of the survivors.

Every gate here cites the measurement that set it. A gate with no number behind
it is marked PENDING and is not a gate yet.

---

## The race, as measured

Fixed start and finish. A **menu** of candidate checkpoints. The player picks
which ones to visit, in what order, and what time to leave.

Checkpoints are **pass-through, not stops** — the clock never pauses, and the
entire cost of a checkpoint is getting into the city and back out.

That format is not a style choice. It is the only one that produced a decision.

---

## A. Shape

| gate | value | why |
| --- | --- | --- |
| Menu size | **7–9 candidates** | Pick-4-of-8 is 70 choices. Below seven the selection is thin; ten would be 210 and tips into enumeration. |
| Checkpoints required | **4**, sometimes 5 | Measured sweet spot — §6 of the findings. |
| Checkpoints are pass-through | always | A stop that pauses the clock removes the reason arrival hour matters. |
| Checkpoints sit **inside** cities | required | Urban penetration is the whole mechanism. A motorway route bypasses city centres: traffic costs 1.5–3.8% of a spine run against **66% on an 86 km leg through the Randstad**. |
| Start and finish | named, findable, fixed | Not player-chosen. The player's freedom is the middle. |
| Elapsed at legal speed | **40–70 h** continental | A four-checkpoint continental race measures 56 h. Regional scale is unmeasured — see Open. |

---

## B. Decision — is there one

Four gates, each with the number that set it.

| gate | threshold | measured |
| --- | --- | --- |
| **Selection penalty** | median wrong pick ≥ **+20%** | +31.3% at pick-4-of-8 (worst +60.8%) |
| **Ordering vs greedy** | ≥ **+10%** | +10.3% at four checkpoints |
| **Near-tie ceiling** | ≤ **10%** of orderings within 1% of best | 5.2% at four checkpoints |
| **Departure leverage** | ≥ **60 min** absolute, best hour to worst | 1h30 on both a 34 h and a 75 h race |

### Why greedy, and why near-ties

Measure ordering against **greedy nearest-unvisited-city**, never against the
median. The median moves smoothly with checkpoint count and says nothing: it
grows at a flat ~5.5% per checkpoint whatever the race. Greedy is what a
competent player actually does, and it is what collapses — already optimal on
20 of 28 two-checkpoint races, on 0 of 28 at six.

The near-tie ceiling catches the failure greedy misses. At two checkpoints
**51.8% of orderings are within 1% of best** — half the answers are right, so
there is no decision however large the spread looks.

### Why selection is the load-bearing gate

Ordering a fixed set is a travelling-salesman problem and **Google Maps solves
those** — its waypoint optimiser takes up to ten stops. Since the free-flow
order is the traffic order on 233 of 247 races, its answer would be ours.

Ordering alone does not clear the second-browser-tab bar. Subset selection is
not a feature Google offers, and it is the bigger decision anyway.

---

## C. Gates deleted, and the measurement that deleted them

Kept as a record so they are not reinvented.

| deleted gate | why |
| --- | --- |
| ≥2 distinct corridors within +20% | Corridors exist, but the fastest one wins under every system tested. Choosing between them is not a decision. |
| Corridor character spread ≥ 0.10 | Measures whether corridors differ. They do. It never changed which one won. |
| Shortest ≠ fastest by ≥12% | True, and nobody plans by distance. It gates nothing. |
| Driving-hours bite | Identical path on 100% of 9,310 puzzles. A near-uniform ~17% tax. |
| Fuel forces a corridor choice | Priced as a cost, fuel never changed the winner at any range. Stops scale with distance, which scales with time. |
| Jurisdiction / enforcement spread | Exposure varies 1.8×, but the **fastest** corridor has the least. It widens the gap rather than closing it. |
| Traffic reorders corridors | Every corridor slows together, and the free-flow order is the traffic order. Traffic is priced into the clock, not the route. |

**Corridors are not deleted from the game, only from the gates.** They are what
makes a mid-race adjustment possible when an incident blocks the spine — a
playability requirement for a system that does not exist yet, not a filter on
whether a race is worth shipping.

---

## D. Gates that are still on paper

Marked PENDING. Each names what has to exist before it can run.

| gate | needs |
| --- | --- |
| **Fuel range bites** — at least one viable route whose worst services-only gap exceeds the range of at least one shippable car | The car table. Gaps measured at 383 / 450 / 738 km on one run, 127 / 251 km on another — a 1.9–2× spread. Typical range is 700–1,000 km, so the band that bites is a **400–700 km car**. |
| **Country spread** — the race crosses ≥4 countries | Country tags on graph edges. Carried over from the old section A and still unmeasurable. |
| **Incidents can reverse a route** | The incident system. This is the one unmodelled thing that could make a slower corridor correct, because it is discrete and cannot average out. |

---

## E. Verification

Clock starts at departure and never stops. No rest credit, no stop credit —
every stop is elapsed time. Deterministic replay from recorded inputs is the
proof, and `core-loop/` already does it.

Every race is stamped with the world version it was planned against
(`graph.meta.json` `built`), per `2026-08-22-infrastructure-decisions.md`. A
route is stored as geography, never as node IDs.

---

## Career and daily

**Career races** are hand-picked. The menu is editorial: eight cities that
create a real selection problem is a judgement, not an algorithm. The Barcelona
–Istanbul pool — Paris, Amsterdam, Copenhagen, Berlin, Munich, Vienna, Rome,
Milan — clears every gate in section B and is the reference.

**Daily races are derived from career races, not generated fresh.** Literacy
comes from meeting the same roads repeatedly; procedurally generated routes
would mean rarely driving the same road twice, which the design intent rejects.
Dailies draw from the **union of roads the career races use**.

A daily must clear section **B** at its own scale. Section **A** does not
apply — a daily is a leg, not a race.

---

## Not gates

Weather, vehicle failure and traffic are **systems**. They vary a race; they do
not decide whether one is worth shipping. Traffic in particular has now been
measured twice as not affecting route choice at all, and it is still the largest
system in the game at 5–11 hours.

---

## Open

- **Regional scale is unmeasured.** Every continental checkpoint costs about
  five hours of run length, so four checkpoints lands on 56 h. Whether a France
  -sized race can hold the same section B numbers inside 8–12 h is the next
  measurement, and it decides whether the first shippable race is continental
  or regional.
- **What the planner shows is the difficulty dial.** All the numbers above
  assume the player estimates. Hand over exact times and pick-4-of-8 becomes 70
  rows in a spreadsheet.
- **The car table does not exist.** Roughly twenty cars, tank litres and
  L/100 km. Range follows from those two numbers and is the whole fuel mechanic.
- Terminal endpoints still need a real list if any race uses the old
  point-to-point shape. Perhaps forty of them in Europe, and picking them is
  editorial.
