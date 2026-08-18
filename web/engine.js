// Game rules. No DOM in here, so the terminal playtest and the browser agree
// on what a legal move is and what a round is worth.

export function buildGraph(data) {
  const cities = data.cities.map(([name, country, x, y], i) => ({ i, name, country, x, y }));
  const adj = cities.map(() => []);
  for (const [a, b, km, min] of data.edges) {
    adj[a].push({ to: b, km, min });
    adj[b].push({ to: a, km, min });
  }
  return { cities, adj, n: cities.length, view: data.view, countries: data.countries };
}

/** Straight-line distance in projected kilometres — what the map shows. */
export function crow(g, i, j) {
  const a = g.cities[i], b = g.cities[j];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dijkstra(g, src) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  const done = new Uint8Array(g.n);
  dist[src] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < g.n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u === -1) break;
    done[u] = 1;
    for (const e of g.adj[u]) {
      const d = dist[u] + e.km;
      if (d < dist[e.to]) { dist[e.to] = d; prev[e.to] = u; }
    }
  }
  return { dist, prev };
}

/** The answer the engine always knows and the player never needs. */
export function optimalRoute(g, src, dst) {
  const { dist, prev } = dijkstra(g, src);
  const path = [];
  for (let v = dst; v !== -1; v = prev[v]) { path.push(v); if (v === src) break; }
  path.reverse();
  let minutes = 0;
  for (let i = 1; i < path.length; i++) minutes += g.adj[path[i - 1]].find((e) => e.to === path[i]).min;
  return { path, km: Math.round(dist[dst]), minutes: Math.round(minutes) };
}

export function newRound(g, { a, b, budget }) {
  return {
    start: a, target: b, budget,
    at: a, spent: 0, minutes: 0,
    visited: new Set([a]),
    hops: [],
    finished: false,
    deadEnd: false,
  };
}

/** Cities you may hop to: adjacent, and not already stood in. */
export function options(g, round) {
  return round.finished ? [] : g.adj[round.at].filter((e) => !round.visited.has(e.to));
}

export function hop(g, round, to) {
  const edge = options(g, round).find((e) => e.to === to);
  if (!edge) return round;
  round.hops.push({
    from: round.at, to, km: edge.km, min: edge.min,
    // What the map suggested it would cost, kept so the reveal can show the
    // gap between the straight line and the road.
    crow: Math.round(crow(g, round.at, to)),
  });
  round.spent += edge.km;
  round.minutes += edge.min;
  round.at = to;
  round.visited.add(to);
  if (to === round.target) round.finished = true;
  else if (options(g, round).length === 0) { round.finished = true; round.deadEnd = true; }
  return round;
}

export const remaining = (round) => round.budget - round.spent;

/** How hard the terrain overcharged for a hop, relative to the straight line. */
export function hopGlyph(h) {
  const ratio = h.km / Math.max(h.crow, 1);
  return ratio > 1.35 ? '▲' : ratio > 1.15 ? '◆' : '·';
}

export function shareString(g, round, dayNumber) {
  const left = remaining(round);
  const head = dayNumber == null ? 'Route · practice' : `Route #${dayNumber}`;
  return [
    `${head} · ${g.cities[round.start].name} → ${g.cities[round.target].name}`,
    round.deadEnd ? 'dead end' : `${Math.round(round.spent)} / ${round.budget} km`,
    round.hops.map(hopGlyph).join(''),
    round.deadEnd ? 'DNF' : `${left >= 0 ? '+' : '−'}${Math.abs(Math.round(left))} km`,
  ].join('\n');
}

/** Same puzzle for everyone, keyed to the UTC date. */
export const EPOCH = Date.UTC(2026, 0, 1);
export function dayNumber(now = Date.now()) {
  return Math.floor((now - EPOCH) / 86400000) + 1;
}
