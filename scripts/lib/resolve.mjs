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

import { routeTimed, isDerestricted } from './road-graph.mjs';
import { congestion } from './traffic.mjs';
import { cruiseKmh } from './cars.mjs';

/** Minutes to cover one edge in this car: its own cruise speed where the road
 * is derestricted, the posted limit everywhere else. */
export function carMinutes(g, edge, car) {
  const kmh = isDerestricted(g, edge) ? cruiseKmh(car) : Math.min(g.kmh[edge], cruiseKmh(car));
  return (g.m[edge] / 1000) / kmh * 60;
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
  const { g, urban, through } = world;
  const cost = (edge, clock) => carMinutes(g, edge, car) * congestion(g, urban, through, edge, clock);

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
