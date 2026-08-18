// Game rules. No DOM in here, so the terminal playtest and the browser agree
// on what a legal move is and what a round is worth.
//
// The currency is TIME. Distance is visible — the roads are drawn — and is
// exactly the trap: across this graph the shortest route is the fastest one
// only 37% of the time.

export function buildGraph(data) {
  const cities = data.cities.map(([name, country, x, y], i) => ({ i, name, country, x, y }));
  const adj = cities.map(() => []);
  for (const [a, b, km, min, ...shape] of data.edges) {
    adj[a].push({ to: b, km, min, shape });
    adj[b].push({ to: a, km, min, shape });
  }
  return { cities, adj, n: cities.length, view: data.view, countries: data.countries };
}

/** The road's own shape, as an SVG path. Reversed when driven the other way. */
export function roadPath(edge, from, to) {
  const { shape } = edge;
  if (!shape || shape.length < 4) return null;
  const pts = [];
  for (let i = 0; i < shape.length; i += 2) pts.push([shape[i], shape[i + 1]]);
  // Geometry is stored a->b; if the first point is nearer `to`, we're driving it
  // backwards. Direction only matters for drawing animations, not for the shape.
  const head = pts[0];
  const flip = Math.hypot(head[0] - from.x, head[1] - from.y)
    > Math.hypot(head[0] - to.x, head[1] - to.y);
  const ordered = flip ? pts.slice().reverse() : pts;
  return `M${ordered.map(([x, y]) => `${x} ${y}`).join('L')}`;
}

export function crow(g, i, j) {
  const a = g.cities[i], b = g.cities[j];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dijkstra(g, src, weight = (e) => e.min) {
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
      const d = dist[u] + weight(e);
      if (d < dist[e.to]) { dist[e.to] = d; prev[e.to] = u; }
    }
  }
  return { dist, prev };
}

function trace(g, prev, src, dst) {
  const path = [];
  for (let v = dst; v !== -1; v = prev[v]) { path.push(v); if (v === src) break; }
  path.reverse();
  let minutes = 0, km = 0;
  for (let i = 1; i < path.length; i++) {
    const e = g.adj[path[i - 1]].find((x) => x.to === path[i]);
    minutes += e.min; km += e.km;
  }
  return { path, minutes: Math.round(minutes), km: Math.round(km) };
}

/** The answer the engine always knows and the player never needs. */
export function fastestRoute(g, src, dst) {
  return trace(g, dijkstra(g, src).prev, src, dst);
}

/** The trap: the route you get by trusting the map and taking the short way. */
export function shortestRoute(g, src, dst) {
  return trace(g, dijkstra(g, src, (e) => e.km).prev, src, dst);
}

export function newRound(g, { a, b, budget }) {
  return {
    start: a, target: b, budget,
    at: a, spent: 0, km: 0,
    visited: new Set([a]),
    hops: [],
    finished: false,
    deadEnd: false,
  };
}

export function options(g, round) {
  return round.finished ? [] : g.adj[round.at].filter((e) => !round.visited.has(e.to));
}

export function hop(g, round, to) {
  const edge = options(g, round).find((e) => e.to === to);
  if (!edge) return round;
  round.hops.push({ from: round.at, to, km: edge.km, min: edge.min });
  round.spent += edge.min;
  round.km += edge.km;
  round.at = to;
  round.visited.add(to);
  if (to === round.target) round.finished = true;
  else if (options(g, round).length === 0) { round.finished = true; round.deadEnd = true; }
  return round;
}

export const remaining = (round) => round.budget - round.spent;

/** Minutes as a driver reads them: 27h15. */
export function hhmm(minutes) {
  const sign = minutes < 0 ? '−' : '';
  const m = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

export const speedOf = (h) => h.km / (h.min / 60);

/** How the road ran, which is the thing the map would not tell you. */
export function hopGlyph(h) {
  const kmh = speedOf(h);
  return kmh < 65 ? '▲' : kmh < 85 ? '◆' : '·';
}

export function shareString(g, round, dayNumber) {
  const left = remaining(round);
  const head = dayNumber == null ? 'Route · practice' : `Route #${dayNumber}`;
  return [
    `${head} · ${g.cities[round.start].name} → ${g.cities[round.target].name}`,
    round.deadEnd ? 'dead end' : `${hhmm(round.spent)} / ${hhmm(round.budget)}`,
    round.hops.map(hopGlyph).join(''),
    round.deadEnd ? 'DNF' : `${left >= 0 ? '+' : '−'}${hhmm(Math.abs(left))}`,
  ].join('\n');
}

/** Same puzzle for everyone, keyed to the UTC date. */
export const EPOCH = Date.UTC(2026, 0, 1);
export function dayNumber(now = Date.now()) {
  return Math.floor((now - EPOCH) / 86400000) + 1;
}
