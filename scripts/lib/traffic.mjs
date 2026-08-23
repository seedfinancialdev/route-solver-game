// Traffic: the load-bearing system.
//
// Three systems came back inert — driving hours, fuel, enforcement exposure —
// and they failed the same way. Every one of them is correlated with the road
// hierarchy, and in a cannonball the hierarchy aligns everything: the motorway
// is fastest, has the fewest limit drops, the most services and the fewest
// villages. Nothing slower wins on any axis, so nothing reverses a ranking.
//
// All three measurements were also taken on a graph with NO TIME IN IT. That is
// the real finding. A world with no conditions has a solved route, correctly.
//
// Traffic is the first system whose cost varies with *when* rather than with
// distance, and it attacks the fast road specifically: a motorway through a
// metro at 08:00 is worse than the bypass, and no slower road is affected the
// same way. That is the shape needed to reverse a ranking.
//
// MODELLED, not imported. Real historical traffic is licensed (Google, TomTom,
// HERE) and does not fit "import and refresh". This is a stated model built on
// data we do have: where the residential road network is dense, which is where
// people live, which is where commuter traffic is. Labelled as a model wherever
// a player can see it — see the data settlement in
// docs/superpowers/specs/2026-08-23-system-coupling-findings.md.

const CELL = 0.1;                       // ~11 km, about the scale of a metro's grip
const key = (lon, lat) => `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;

/** Roads that mean "people live here" rather than "people drive through here". */
const RESIDENTIAL = new Set(['residential', 'living_street']);

/**
 * Residential road length per cell, as a proxy for how much of a city is here.
 *
 * Built from the graph rather than imported: 19 million residential edges is a
 * better map of where people actually live than any polygon set we could pull,
 * and it costs one pass.
 */
export function buildUrbanField(g) {
  const res = new Set(RESIDENTIAL);
  const ids = new Set(g.meta.classes.map((c, i) => (res.has(c) ? i : -1)).filter((i) => i >= 0));
  const field = new Map();
  let peak = 0;
  for (let e = 0; e < g.e; e++) {
    if (!ids.has(g.cls[e])) continue;
    const a = g.a[e];
    const k = key(g.xy[2 * a], g.xy[2 * a + 1]);
    const v = (field.get(k) || 0) + g.m[e];
    field.set(k, v);
    if (v > peak) peak = v;
  }
  return { field, peak };
}

/**
 * How urban a point is, 0 to 1.
 *
 * Square-rooted because the raw distribution is extremely long-tailed — one
 * metro dwarfs a hundred towns, and a linear scale would make everywhere except
 * Paris read as countryside.
 */
export function urbanness(urban, lon, lat) {
  const v = urban.field.get(key(lon, lat)) || 0;
  return Math.min(1, Math.sqrt(v / (urban.peak * 0.25)));
}

/**
 * Congestion multiplier on travel time by hour of day.
 *
 * Two peaks, a midday plateau and free-running nights. Values are a stated
 * model, not measured: a bad urban peak roughly doubles journey time, which is
 * the right order for a motorway through a metro at rush hour.
 */
const HOUR_PROFILE = [
  0.00, 0.00, 0.00, 0.00, 0.05, 0.20,   // 00-05
  0.55, 0.95, 1.00, 0.75, 0.45, 0.40,   // 06-11
  0.45, 0.45, 0.45, 0.60, 0.85, 1.00,   // 12-17
  0.80, 0.45, 0.20, 0.10, 0.05, 0.00,   // 18-23
];

export const MAX_SLOWDOWN = 1.0;        // +100% at a full urban peak

/** Roads that carry commuter traffic. A residential street is already slow. */
const THROUGH = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);

export function throughClasses(g) {
  return new Set(g.meta.classes.map((c, i) => (THROUGH.has(c) ? i : -1)).filter((i) => i >= 0));
}

/**
 * Multiplier on an edge's free-flow travel time at a given clock time.
 *
 * @param minutes minutes since midnight on the day of travel; wraps.
 */
export function congestion(g, urban, through, edge, minutes) {
  if (!through.has(g.cls[edge])) return 1;
  const a = g.a[edge];
  const u = urbanness(urban, g.xy[2 * a], g.xy[2 * a + 1]);
  if (u <= 0) return 1;
  const h = ((minutes % 1440) + 1440) % 1440 / 60;
  const i = Math.floor(h);
  const frac = h - i;
  const p = HOUR_PROFILE[i] * (1 - frac) + HOUR_PROFILE[(i + 1) % 24] * frac;
  return 1 + p * u * MAX_SLOWDOWN;
}
