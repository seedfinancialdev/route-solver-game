// Resolving one plan.
//
// The measurement gates search thousands of hypothetical plans against a
// cached matrix. A player resolves exactly one — the one they actually
// chose — so this calls routeTimed() live, per leg, on the real graph.
// A few live searches per attempt is the right cost for that, and it means
// the result is never stale against what the gates measure.
//
// A car's effect is real here in a way the cached matrix cannot express: the
// matrix is built once, at whatever pace travelMinutes() gives an edge, with
// no notion of a specific car. This module is what actually spends a car's
// cruise speed on the 19,029 km of derestricted autobahn that measurement 8
// found — see docs/superpowers/specs/2026-08-23-system-coupling-findings.md.

import { routeTimed, junctionNode, isDerestricted } from './road-graph.mjs';
import { congestion } from './traffic.mjs';
import { cruiseKmh } from './cars.mjs';

/** Minutes to cover one edge in this car: its own cruise speed where the road
 * is derestricted, the posted limit everywhere else. */
export function carMinutes(g, edge, car) {
  const kmh = isDerestricted(g, edge) ? cruiseKmh(car) : Math.min(g.kmh[edge], cruiseKmh(car));
  return (g.m[edge] / 1000) / kmh * 60;
}

/** This car's per-edge time-of-day cost function, shared by every routeTimed
 * call in this module so a detour is priced the exact same way the default
 * route is. */
function legCost(world, car) {
  const { g, urban, through } = world;
  return (edge, clock) => carMinutes(g, edge, car) * congestion(g, urban, through, edge, clock);
}

function findIncident(incidents, fromName, toName) {
  return incidents.find((i) => (i.from === fromName && i.to === toName) || (i.from === toName && i.to === fromName));
}

/**
 * A leg's shape, as junction positions strung together.
 *
 * The graph stores no road geometry, only where junctions sit (same caveat
 * documented in scripts/19-run-geometry.mjs) — so this is straight lines
 * between them, not a survey-accurate polyline. Good enough to show a player
 * what road their plan actually took; it will cut corners at close zoom.
 */
export function edgeLine(g, edges) {
  const pts = edges.map((e) => [g.xy[2 * g.a[e]], g.xy[2 * g.a[e] + 1]]);
  const last = edges[edges.length - 1];
  pts.push([g.xy[2 * g.b[last]], g.xy[2 * g.b[last] + 1]]);
  return pts;
}

/**
 * Resolve one plan: an ordered stop sequence, in this car, leaving at this
 * time, on this day's incidents.
 *
 * @param world   { g, urban, through } — the loaded graph and traffic field
 * @param stops   [{ name, node }], indexed the same way `order` refers to them
 * @param order   stop indices in the order the player chose to drive them
 * @param car     anything cruiseKmh() accepts — a garage car, modded or not
 * @param incidents  today's [{ from, to, delayMinutes, note }], matched by
 *                   stop name in either direction
 * @returns { totalMinutes, arrivalMinutes, legs } or null if any leg is
 *          unreachable — never NaN, never a partial result silently returned.
 */
export function resolveRun(world, stops, order, car, departMinutes, incidents) {
  const { g } = world;
  const cost = legCost(world, car);

  let clock = departMinutes;
  const legs = [];
  for (let k = 1; k < order.length; k++) {
    const from = stops[order[k - 1]], to = stops[order[k]];
    const r = routeTimed(g, from.node, to.node, clock, cost);
    if (!r) return null;
    const incident = findIncident(incidents, from.name, to.name);
    const minutes = r.minutes + (incident ? incident.delayMinutes : 0);
    legs.push({
      from: from.name, to: to.name, minutes, km: r.km,
      incidentMinutes: incident ? incident.delayMinutes : 0,
      incidentNote: incident ? incident.note : null,
      coordinates: edgeLine(g, r.edges),
    });
    clock += minutes;
  }
  const totalMinutes = legs.reduce((s, l) => s + l.minutes, 0);
  return { totalMinutes, arrivalMinutes: departMinutes + totalMinutes, legs };
}

/**
 * Resolve one leg forced through a specific point — the mechanism behind
 * dragging the route on the map, Google-Maps-style. The default route (see
 * resolveRun) is the naive backfill; this is what happens the instant a
 * player drops a dragged waypoint onto it. No new pathfinding: a forced
 * waypoint is just two ordinary routeTimed searches back to back, from the
 * leg's start to the waypoint and from the waypoint to the leg's end, priced
 * by the exact same cost function so a detour and the default are directly
 * comparable.
 *
 * @param waypointLonLat  a raw map click — snapped to the nearest real
 *                        junction via junctionNode(), the same snap every
 *                        other checkpoint in this game gets
 * @returns the same leg shape resolveRun's legs[] use, or null if the
 *          waypoint cannot reach either the start or the destination
 */
export function resolveLegWithWaypoint(world, from, to, waypointLonLat, car, departMinutes, incidents) {
  const { g } = world;
  const cost = legCost(world, car);
  const waypointNode = junctionNode(g, waypointLonLat[0], waypointLonLat[1]);

  const first = routeTimed(g, from.node, waypointNode, departMinutes, cost);
  if (!first) return null;
  const second = routeTimed(g, waypointNode, to.node, departMinutes + first.minutes, cost);
  if (!second) return null;

  const incident = findIncident(incidents, from.name, to.name);
  const minutes = first.minutes + second.minutes + (incident ? incident.delayMinutes : 0);
  return {
    from: from.name, to: to.name, minutes, km: first.km + second.km,
    incidentMinutes: incident ? incident.delayMinutes : 0,
    incidentNote: incident ? incident.note : null,
    // second's line repeats the waypoint junction where it joins first's —
    // drop that one duplicate rather than leave a zero-length seam.
    coordinates: edgeLine(g, first.edges).concat(edgeLine(g, second.edges).slice(1)),
    viaWaypoint: true,
  };
}
