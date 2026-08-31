# blind-map: the map-legibility test harness

Proves (or disproves) `docs/superpowers/specs/2026-08-30-design-intent.md`'s
Phase 2 gate: *"at a junction, can a person identify the branches and form a
hypothesis about which leads toward the objective, and why?"*

## What this tests, and what it deliberately does not

This harness shows real branch geometry and road class (colour and width,
never hue alone) inside a fixed ~300m radius, at a fixed zoom, with no pan
and no zoom. It does **not** yet include signs, sun-shadow direction, or an
actual objective — those are later build-sequence phases. So the honest
version of the test this harness supports is narrower than the full fiction:

> For each candidate junction: how many branches can you see? Can you rank
> them by apparent significance (which looks like the road that goes
> somewhere, which looks minor)? Does the terrain/land-use around the
> junction (forest, farmland, water) read clearly?

If testers can't do that reliably, nothing downstream — signs, the
junction-decision loop, the whole game — is worth building on top of this
map yet.

## Running it

```sh
npm run blind-map:candidates   # regenerate candidates.json from data/road-graph/ (optional — already committed)
npm run blind-map:check        # validate style.js
npm run blind-map              # serve at http://localhost:8141/
```

Needs live internet access while running: the style loads OpenFreeMap vector
tiles and AWS/Mapzen terrain tiles over the network, so it won't render
offline.

## Recording results

Not automated — sit with a tester, show each candidate, ask the questions
above, write down what they say. There's no scoring here; the outcome is a
go/no-go on the map itself, made by a human, the same way design-intent.md's
build sequence requires before anything downstream gets planned.
