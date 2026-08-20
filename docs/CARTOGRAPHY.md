# Cartography bible

Which parts of the map's look carry information the player acts on, and which
are scenery. The two have different change rules: scenery is a taste decision,
load-bearing styling is a difficulty decision, and `npm run balance` is the
arbiter of the second.

**The shipped game is SVG styled by `web/app.css`.** `web/index.html:174` loads
`app.js`, which imports only `engine.js`. The canvas engine under `web/map/` is
the next-gen direction (`docs/MAP-SPEC.md:3`: "Not shipped"), reachable only
from `web/map-studio/`. Both are covered below, separately, because they will
eventually swap places.

`tests/cartography-doc.test.mjs` fails if a token exists in code but is not
classified here.

## Load-bearing

Frozen without a balance argument. These are the player's evidence.

**The pace tell.** A candidate road's drawn weight is how the player guesses
how fast it runs — the README's second paragraph makes this the core of the
puzzle.

| rule | width | encodes |
| --- | --- | --- |
| `.reach-line.pace-2` | 3.4 | candidate road, fastest tier |
| `.reach-line.pace-1` | 2 | candidate road, middle tier |
| `.reach-line.pace-0` | 1.2 | candidate road, slowest tier |
| `.leg.pace-2` | 3.6 | committed leg, fastest tier |
| `.leg.pace-1` | 2.4 | committed leg, middle tier |
| `.leg.pace-0` | 1.5 | committed leg, slowest tier |

The ratio is the signal: 3.4 : 1.2, about 2.8:1, at `web/app.css:228-230`.
Compressing it toward 1:1 deletes the tell and makes the game a coin flip.
Widening it makes the game easier. Either is a difficulty change and needs
`npm run balance` before and after.

Opacity carries the same ordering (.95 / .74 / .56) and must not be inverted
against width — the two channels have to agree or the tell becomes ambiguous.

**Colours that mean something:**

| token | meaning |
| --- | --- |
| `--road` | a road you can take |
| `--road-hot` | the candidate under hover or focus (`.reach-line--hot`) |
| `--reachable` | a city that is a legal move (`.dot--reachable`) |
| `--speck` | a city that exists but is not a legal move (`.dot`) |
| `--accent` | where you are standing (`.dot--current`) |
| `--ink` | the target (`.dot--target`) |
| `--dim` | already visited (`.dot--visited`) |
| `--red` | the budget gauge's alarm state |
| `--amber` | the middle tier of the background road network |
| `--bg` | the halo stroke that separates a legal-move city from the map |

`--road` and `--red` must stay distinguishable — the comment at
`web/app.css:23` already flags that collision. `--road` and `--amber` must stay
distinguishable for the reason in the road-network note below.

`--accent` is defined as var(--neutral) (`web/app.css:31`), so changing the
scenery token --neutral silently changes what "where you are standing" looks
like. Retuning --neutral needs a look at `.dot--current`.

**Never hue alone.** Legal-move versus scenery city, and the three pace tiers,
must survive without colour vision — via width, radius, or stroke. `--bg` is
used as a halo stroke on `.dot--reachable` (`web/app.css:174`) and that
separation is part of the contract, which is why it is listed above rather than
as scenery.

**Background road network.** `.road-network--0/1/2` (`web/app.css:127-129`)
has nothing wired to it, but it is load-bearing in one respect: it must stay
visually separable from `.reach-line`, or the player cannot tell a road they
can take from one they cannot. It currently reuses `--road` and `--amber` at
lower widths and opacities. Open question: whether its three tiers encode pace,
in which case it is a second tell and belongs fully in this section.

## Scenery

Free to retune without a balance argument.

`--land`, `--land-edge`, `--water`, `--water-line`, `--urban`, `--dimmer`,
`--neutral`, `--panel`, `--mono`, `--sans`.

Also scenery: `.street--0/1/2` (the city street grid) and the
`.streets`/`.streets--visible` fade.

`--neutral` carries one caveat: --accent is defined from it, so it is scenery
with a load-bearing consumer. See the note in Load-bearing.

**One constraint.** `.reach-line.pace-0` is the lowest-contrast thing the
player has to read. It must keep a contrast ratio of at least 3:1 — the WCAG
floor for non-text graphical objects — against every scenery colour it can be
drawn over, at its shipped `.56` opacity. Verify by hand when changing a
scenery colour; automate only if it proves to bite.

## Not shipped

`web/map/theme-config.js` defines five presets for the canvas engine that
`web/map-studio/` drives. None of it reaches a player today. Recorded here so
the contract is ready when it ships.

**Would be load-bearing:** `roadMotorway`, `roadTrunk`, `roadPrimary`,
`roadSecondary`, `roadWidthMotorway`, `roadWidthTrunk`, `roadWidthPrimary`
(pace tier, colour and width together — currently 3.2 : 1.4, about 2.3:1);
`cityNode`, `cityNodeActive`, `cityNodeBorder` (scenery versus actionable);
`routeLine`, `routeLineGlow`.

**Would be scenery:** `bg`, `water`, `land`, `coastline`, `borderWidth`,
`forest`, `farmland`, `urbanDay`, `urbanNight`, `urbanGlow`, `terrainOpacity`,
`terrainBlend`, `roadCasing`, `roadDivider`, `hudGlass`, `hudText`.

## Settled, do not revisit

- Real cartographic detail over hillshade relief is a known-good style
  (OpenTopoMap), not a category being invented. See `docs/MAP-SPEC.md`.
- Terrain relief is built and correct. Do not touch it.
- Reveal-by-zoom — overview raster, detail tier, then fine tiles — is the
  loading pattern every new layer copies.

## Open questions

1. Whether `.road-network--0/1/2` encodes pace or road class. Changes which
   section it belongs in.
2. `theme-config.js` ships five presets and `satelliteTopo` is the constructor
   default (`web/map/theme-config.js:165`). Whether the other four are planned
   features, debug affordances, or dead code is not determinable from the file.
