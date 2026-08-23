// Fuel: the first system that can make the fastest route the wrong route.
//
// A cost that scales with time alone cannot change which corridor wins — that
// was measured on the old driving-hours rule, which turned out to be a near
// uniform ~17% tax on time and never once altered the optimal path across
// 9,310 puzzles. Fuel is different because it is coupled to PLACE: it matters
// where the stations are and what kind they are.
//
// The cost of a stop is not the litres. It is the minutes at the pump plus the
// detour, and a motorway services has no detour while a town station costs the
// exit, the streets and the return. That asymmetry is the mechanic: a corridor
// with sparse off-motorway fuel can lose to a slower corridor with services on
// it.

import { readFileSync } from 'node:fs';

export const KIND = { FUEL: 0, SERVICES: 1 };
export const STOP_MINUTES = { [KIND.FUEL]: 12, [KIND.SERVICES]: 8 };

/** How far a driver will divert for fuel before it stops being worth it. */
export const REACH_M = 4000;

const CELL = 0.05;                                    // ~5.5 km, matches the graph's grid
const key = (lon, lat) => `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;

export function loadStations(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const grid = new Map();
  for (const [lon, lat, kind] of raw.stations) {
    const k = key(lon, lat);
    let cell = grid.get(k);
    if (!cell) grid.set(k, (cell = []));
    cell.push([lon, lat, kind]);
  }
  return { grid, count: raw.stations.length };
}

function metres(lon1, lat1, lon2, lat2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1, dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * The best station a driver at this point could divert to.
 *
 * Queried per point on the route rather than precomputed per graph node,
 * because the case that matters is exactly the one a nearest-node attachment
 * misses: a town station two kilometres off a motorway junction. The motorway
 * node is not that station's nearest node, but the driver can still reach it.
 */
export function bestNear(stations, lon, lat, reachM = REACH_M, onlyKind = null) {
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  let best = null, bestCost = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const [slon, slat, kind] of stations.grid.get(`${cx + dx}:${cy + dy}`) || []) {
        const d = metres(lon, lat, slon, slat);
        if (d > reachM) continue;
        if (onlyKind !== null && kind !== onlyKind) continue;
        const cost = STOP_MINUTES[kind] + detourMinutes(d, kind);
        if (cost < bestCost) { bestCost = cost; best = { lon: slon, lat: slat, kind, snapMetres: d, cost }; }
      }
    }
  }
  return best;
}

/** Diversion time, there and back. A services area is on the road already. */
export function detourMinutes(snapMetres, kind) {
  if (kind === KIND.SERVICES) return 0;
  const km = (2 * snapMetres) / 1000;
  return (km / 50) * 60 + 3;              // 50 km/h off-corridor, plus junction time
}

/**
 * Place refuelling stops along a route and price them.
 *
 * Greedy-latest, which is what a real planner does: run the tank down and stop
 * at the last station still in reach. Not optimal — an earlier services can
 * beat a later town station — but it is an honest, identical baseline for every
 * corridor, which is what the gate needs.
 *
 * @param g        road graph
 * @param edges    edge indices along the route, in order
 * @param stations loadStations() result
 * @param rangeKm  usable range on a full tank
 */
export function planFuel(g, edges, stations, rangeKm) {
  const rangeM = rangeKm * 1000;
  const stops = [];
  let sinceFill = 0, travelled = 0, extraMinutes = 0;
  let candidate = null;                   // best reachable station since the last fill

  for (const e of edges) {
    // Look from the far end of each edge: that is where the driver is when the
    // decision to divert has to be made.
    const nodeB = g.b[e];
    const found = bestNear(stations, g.xy[2 * nodeB], g.xy[2 * nodeB + 1]);
    if (found) candidate = { ...found, atKm: (travelled + g.m[e]) / 1000 };

    sinceFill += g.m[e];
    travelled += g.m[e];

    if (sinceFill > rangeM) {
      if (!candidate) {
        return { ok: false, stops, extraMinutes, dryAtKm: travelled / 1000 };
      }
      stops.push(candidate);
      extraMinutes += candidate.cost;
      sinceFill = travelled - candidate.atKm * 1000;
      candidate = null;
      if (sinceFill > rangeM) {
        return { ok: false, stops, extraMinutes, dryAtKm: travelled / 1000 };
      }
    }
  }
  return { ok: true, stops, extraMinutes, dryAtKm: null };
}
