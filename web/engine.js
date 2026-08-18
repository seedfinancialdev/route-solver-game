// Game rules. No DOM in here, so the terminal playtest and the browser agree
// on what a legal move is and what a round is worth.
//
// The currency is TIME. Distance is visible — the roads are drawn — and is
// exactly the trap: across this graph the shortest route is the fastest one
// only 37% of the time.

/** Road shapes ship delta-encoded on a fixed grid; the bundle states which. */
function decodeShape(deltas, quant) {
  const pts = [];
  let x = 0, y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    x += deltas[i]; y += deltas[i + 1];
    pts.push([x / quant, y / quant]);
  }
  return pts;
}

export function buildGraph(data) {
  const countryNames = data.countryNames || {};
  const cities = data.cities.map(([name, country, x, y], i) => (
    { i, name, country, countryName: countryNames[country] || country, x, y }
  ));
  const adj = cities.map(() => []);
  const quant = data.quant || 4;
  const roadNames = data.roadNames || [];
  data.edges.forEach(([a, b, km, min, tiers, ...deltas], i) => {
    const shape = decodeShape(deltas, quant);
    const pace = [...tiers].map(Number);
    // [label, km, sharePercent] of the road's longest named stretch — real
    // OSRM refs/names, for narration only. Never read by the routing itself.
    const road = roadNames[i] ? { label: roadNames[i][0], km: roadNames[i][1], share: roadNames[i][2] } : null;
    adj[a].push({ to: b, km, min, shape, pace, road });
    adj[b].push({ to: a, km, min, shape, pace, road });
  });
  return {
    cities, adj, n: cities.length,
    view: data.view, countries: data.countries,
    lakes: data.lakes || [], rivers: data.rivers || [],
    countryLabels: (data.countryLabels || []).map(([name, x, y]) => ({ name, x, y })),
    urbanAreas: data.urbanAreas || [],
    physicalLabels: (data.physicalLabels || []).map(([name, x, y, kind, lengthKm, peakName, peakM, blurb]) => (
      { name, x, y, kind, lengthKm, peakName, peakM, blurb }
    )),
    towns: (data.towns || []).map(([x, y, tier]) => ({ x, y, tier })),
    graticule: data.graticule || [],
  };
}

/** The road's own shape, as an SVG path. Reversed when driven the other way. */
/** Geometry is stored a->b; driving it the other way reverses shape and pace alike. */
function oriented(edge, from, to) {
  const pts = edge.shape;
  if (!pts || pts.length < 2) return null;
  const head = pts[0];
  const flip = Math.hypot(head[0] - from.x, head[1] - from.y)
    > Math.hypot(head[0] - to.x, head[1] - to.y);
  return flip
    ? { pts: pts.slice().reverse(), pace: edge.pace.slice().reverse() }
    : { pts, pace: edge.pace };
}

export function roadPath(edge, from, to) {
  const o = oriented(edge, from, to);
  return o && `M${o.pts.map(([x, y]) => `${x} ${y}`).join('L')}`;
}

/**
 * The road broken into runs of one pace, so it can be drawn the way a road
 * atlas draws it: the motorway stretches heavy, the slow ones hairline.
 * Runs overlap by a point so the line stays unbroken.
 */
export function roadRuns(edge, from, to) {
  const o = oriented(edge, from, to);
  if (!o) return [];
  const runs = [];
  let start = 0;
  for (let i = 1; i <= o.pts.length; i++) {
    if (i === o.pts.length || o.pace[i] !== o.pace[start]) {
      const slice = o.pts.slice(start, Math.min(i + 1, o.pts.length));
      if (slice.length > 1) {
        runs.push({ tier: o.pace[start], d: `M${slice.map(([x, y]) => `${x} ${y}`).join('L')}` });
      }
      start = i;
    }
  }
  return runs;
}

/** What a hop is made of, for explaining afterwards why it went the way it did. */
export function paceMix(edge) {
  const total = edge.pace.length || 1;
  const count = [0, 0, 0];
  for (const t of edge.pace) count[t]++;
  return count.map((c) => c / total);
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

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function bearingWord(g, from, to) {
  const a = g.cities[from], b = g.cities[to];
  const deg = (Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/**
 * One sentence about how a hop actually went — the road's own name/ref
 * (scripts/06-road-names.mjs, from OSRM; narration only, never routing), the
 * direction, and the pace mix that was already shown as line weight before
 * the player committed. Deliberately stops short of the time/km/km-h receipt
 * — that's shown numerically alongside this, not restated in prose.
 */
export function narrateHop(g, h) {
  const edge = g.adj[h.from].find((e) => e.to === h.to);
  const from = g.cities[h.from].name, to = g.cities[h.to].name;
  const dir = bearingWord(g, h.from, h.to);
  const kmh = speedOf(h);
  const mix = edge ? paceMix(edge) : [0, 1, 0];
  const road = edge && edge.road;

  const onRoad = road
    ? (road.share >= 55 ? `the ${road.label}` : `mostly the ${road.label}`)
    : 'back roads';

  const verdict = kmh >= 85
    ? `clear on ${onRoad} the whole way`
    : kmh >= 65
      ? (mix[0] > 0.35 ? `on ${onRoad}, but it slows for stretches` : `a steady run on ${onRoad}`)
      : (mix[2] > 0.15 ? `on ${onRoad} — fast where it can be, crawling everywhere else` : `on ${onRoad}, and it never opens up`);

  return `Out of ${from} heading ${dir}, ${verdict} to ${to}.`;
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
