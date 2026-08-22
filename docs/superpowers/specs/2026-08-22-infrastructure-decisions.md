# Infrastructure: what is hard to unravel

2026-08-22. Written before standing anything up, because three of these get
harder to change the longer the game runs, and the rest do not matter much.

---

## The three that are hard to unravel

### 1. Route identity must survive a graph rebuild

A saved route cannot be a list of our graph's node IDs. Those IDs come from the
order OSM ways happen to be read; refresh the extract and every one of them
moves. Every stored run, record and replay would silently point somewhere else.

**Store a route as geography, not as topology.** Waypoints as lon/lat, the
snapped path as lon/lat, and the graph version it was snapped against. On a
rebuild, re-snap. A route that no longer snaps cleanly is a flagged migration,
not a corrupted record.

*Cost if wrong:* every record and replay ever set becomes unverifiable the first
time the map is refreshed, and there is no way to recover them.

### 2. Every run carries the world version it was played on

The game promises to model only what it can import and refresh — real speed
limits, fuel, tolls, borders. That data moves. A service area closes, a limit
changes, a border opens. Runs set before and after are not comparable, and a
leaderboard that mixes them is quietly wrong.

**Stamp every run with a world version.** Records compare only within a
version. Refresh on a season boundary rather than continuously, so a version has
a meaningful lifetime.

This is the same mechanism the design intent already specifies for weather —
snapshot it, freeze it, everyone plays the identical frozen reality — applied to
the whole world rather than to one system.

*Cost if wrong:* the leaderboard is meaningless and nobody can tell, because the
drift is invisible.

### 3. The simulation is server-authoritative

The Europe road graph is ~250 MB. Too large to ship to a browser, and the client
should not own the numbers regardless: if the client computes its own elapsed
time, a verified record means nothing.

**Routing and simulation run on the server. The client sends intent — waypoints,
recon pins, departure time — and gets back a route and a result.**

This ends the static-files model the project has used so far. That is the real
decision on this page.

*Cost if wrong:* moving authority across the wire later is a rewrite of both
sides, and any records set before the move cannot be trusted retroactively.

---

## Swappable — do not agonise

| thing | why it is cheap to change |
| --- | --- |
| Vector tile source | OpenFreeMap today; self-hosted PMTiles later. A URL. |
| DEM source | AWS terrarium tiles. Also a URL. |
| Road graph format | Derived from the PBFs. Rebuildable at any time. |
| Frontend hosting | Static assets. |
| Which cloud vendor | See below — the shape matters, the logo does not. |

---

## Shape, when it is needed

Not yet built. Recorded so the decision is not made by accident later.

- **Routing / simulation service** — holds the graph in memory, answers routing
  and result queries. Needs RAM and a persistent disk, not edge functions.
- **Database** — runs, records, replays, world versions, player state.
- **Frontend** — static, talks to the service.
- **Secrets** — one store, not environment files.

Railway, Supabase, Vercel and Doppler are already connected to this workspace
and fit that shape. Nothing here depends on that choice.

---

## Not decided

- Whether the player's browser ever routes locally for responsiveness, with the
  server as the authority that re-computes and confirms. Attractive for feel,
  and it does not conflict with decision 3 as long as the server's answer is the
  one that counts.
- Season length, which is what makes a world version meaningful.
- Whether replays store inputs (small, needs a deterministic sim) or the
  resulting path (large, but robust to sim changes). `core-loop/` already proves
  deterministic replay from inputs.
