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
    physicalLabels: (data.physicalLabels || []).map(([name, x, y, kind, lengthKm, peakName, peakM, blurb, pacePct]) => (
      { name, x, y, kind, lengthKm, peakName, peakM, blurb, pacePct }
    )),
    towns: (data.towns || []).map(([x, y, tier]) => ({ x, y, tier })),
    graticule: data.graticule || [],
    // ISO2 -> {motorway, rural, urban, note?}, real and sourced (real racing
    // rules, not just real roads — same spirit as the driving-hours rule):
    // scripts/lib/country-facts.mjs.
    countrySpeed: data.countrySpeed || {},
    countryNames,
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

/** The answer the engine always knows and the player never needs — real driving time only. */
export function fastestRoute(g, src, dst) {
  return trace(g, dijkstra(g, src).prev, src, dst);
}

/**
 * The trap: the route you get by trusting the map and taking the short way.
 * Charged the same driving-hours rule as any other route — the shortest road
 * doesn't skip mandatory breaks any more than the fastest one does, so its
 * minutes have to come from walking the path with hosCost, not a plain sum
 * of edge.min (mirrors play/bots.mjs's shortestRouter exactly).
 */
export function shortestRoute(g, src, dst) {
  const { path } = trace(g, dijkstra(g, src, (e) => e.km).prev, src, dst);
  let minutes = 0, km = 0, sinceRest = 0;
  for (let i = 1; i < path.length; i++) {
    const e = g.adj[path[i - 1]].find((x) => x.to === path[i]);
    const cost = hosCost(sinceRest, e.min);
    minutes += cost.charged; km += e.km; sinceRest = cost.sinceRest;
  }
  return { path, minutes: Math.round(minutes), km: Math.round(km) };
}

// --- endurance-racing rules: EU professional-driver hours (EC 561/2006) ----
// Real regulation, simplified for a turn-based game: 4.5 hours (270 min) of
// continuous driving forces a 45-minute break, charged in whole units at hop
// boundaries. Mirrors scripts/lib/graph.mjs's hosCost/hosDijkstra exactly —
// same rule, same numbers — kept as a second copy here the way this file
// already keeps its own dijkstra() rather than importing the Node one, since
// nothing here can import fs-touching build scripts into the browser.
export const HOS_CONTINUOUS_LIMIT = 270;
export const HOS_BREAK_MIN = 45;

/** Minutes actually charged for a hop, and the driving-clock state it leaves you in. */
export function hosCost(sinceRest, hopMin) {
  const total = sinceRest + hopMin;
  const breaks = Math.floor(total / HOS_CONTINUOUS_LIMIT);
  return { charged: hopMin + breaks * HOS_BREAK_MIN, sinceRest: total % HOS_CONTINUOUS_LIMIT, breaks };
}

/**
 * The fastest *legal* route: Dijkstra over (city, minutes-since-last-break)
 * states, since the same road can cost a hop's plain minutes or that plus a
 * mandatory break depending on how much continuous driving is already
 * banked on arrival — genuinely path-dependent, not something a plain
 * shortest path can answer. Mirrors scripts/lib/graph.mjs's hosDijkstra —
 * same algorithm, kept as its own copy for the reason dijkstra() above
 * already is one: nothing here can import the Node build scripts.
 * Runs once, on demand, at the reveal — not hot-path code.
 */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, key) {
    const a = this.a; a.push([key, item]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top && top[1];
  }
}

export function hosRoute(g, src, dst) {
  const L = HOS_CONTINUOUS_LIMIT;
  const state = (city, rest) => city * L + rest;
  const dist = new Map(), prev = new Map(), done = new Set();
  const start = state(src, 0);
  dist.set(start, 0);
  const heap = new MinHeap();
  heap.push(start, 0);
  let bestState = -1, bestDist = Infinity;

  while (heap.size) {
    const u = heap.pop();
    if (done.has(u)) continue;
    done.add(u);
    const city = Math.floor(u / L), rest = u % L;
    if (city === dst) { bestState = u; bestDist = dist.get(u); break; }
    const d = dist.get(u);
    for (const e of g.adj[city]) {
      const c = hosCost(rest, e.min);
      const v = state(e.to, c.sinceRest);
      const nd = d + c.charged;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push(v, nd); }
    }
  }
  if (bestState === -1) return { path: [], minutes: Infinity, km: 0, stuck: true };

  const path = [];
  for (let v = bestState; v !== undefined; v = prev.get(v)) {
    path.push(Math.floor(v / L));
    if (v === start) break;
  }
  path.reverse();
  let km = 0;
  for (let i = 1; i < path.length; i++) km += g.adj[path[i - 1]].find((e) => e.to === path[i]).km;
  return { path, minutes: Math.round(bestDist), km: Math.round(km), stuck: false };
}

export function newRound(g, { a, b, budget }) {
  return {
    start: a, target: b, budget,
    at: a, spent: 0, km: 0, sinceRest: 0,
    visited: new Set([a]),
    hops: [],
    finished: false,
    deadEnd: false,
  };
}

export function options(g, round) {
  return round.finished ? [] : g.adj[round.at].filter((e) => !round.visited.has(e.to));
}

// --- push: hold the limit, or don't -----------------------------------
// A second lever, independent of the road-reading judgement above: not
// which road you take, but how you drive the one you're on. Real country
// speed limits are already on the HUD (country-facts.mjs); pushing is the
// choice to run past them. The gain and the risk both key off paceMix —
// the same real tier composition already setting the reach-line weight —
// so pushing is naturally worth the most on an open motorway stretch and
// barely worth anything on a tight, slow road, the way it actually would
// be. These multipliers are a designed mechanic, not a sourced fact —
// there's no real-world table for "how much can a driver safely push" —
// and they're a first pass: worth the same calibration discipline as the
// budget multiplier (play/calibrate.mjs) once a push-aware bot model
// exists to measure against, not treated as finished.
const PUSH_GAIN = [1.03, 1.12, 1.22];     // slow, ordinary, fast tier — speed multiplier while pushing
const PUSH_RISK_WEIGHT = [3, 1.5, 0.5];   // relative exposure per km, same tier order — tight roads are the risky place to push, not the motorway
const PUSH_RISK_PER_KM = 0.00085;         // scaled so a typical ~150 km mixed-tier hop lands near an 18% catch chance
const PUSH_RISK_CAP = 0.6;
export const PUSH_CAUGHT_MIN = 30;        // flat time lost to a stop — never counts as rest, see hop() below

export function pushGainFactor(edge) {
  const mix = paceMix(edge);
  return mix[0] * PUSH_GAIN[0] + mix[1] * PUSH_GAIN[1] + mix[2] * PUSH_GAIN[2];
}

export function pushRiskChance(edge) {
  const mix = paceMix(edge);
  const weight = mix[0] * PUSH_RISK_WEIGHT[0] + mix[1] * PUSH_RISK_WEIGHT[1] + mix[2] * PUSH_RISK_WEIGHT[2];
  return Math.min(PUSH_RISK_CAP, edge.km * weight * PUSH_RISK_PER_KM);
}

/**
 * `push` drives the hop past the limit: driveMin drops by pushGainFactor,
 * and pushRiskChance is rolled for a stop. `forceCaught` overrides that roll
 * — restore() needs it, to replay a saved run's exact outcome instead of
 * re-rolling a new one against the same odds.
 */
export function hop(g, round, to, { push = false, forceCaught } = {}) {
  const edge = options(g, round).find((e) => e.to === to);
  if (!edge) return round;
  const caught = push && (forceCaught ?? Math.random() < pushRiskChance(edge));
  // Caught forfeits the gain, not just adds a tax on top of it — otherwise a
  // big enough gain on a long hop lets a ticket still net ahead of not
  // pushing at all, which isn't a real risk, just a smaller reward.
  const driveMin = push && !caught ? edge.min / pushGainFactor(edge) : edge.min;
  const caughtMin = caught ? PUSH_CAUGHT_MIN : 0;
  // Whatever a stop costs counts toward the clock like any other driving
  // time — it can even tip you into a mandatory break — but it never resets
  // sinceRest the way an actual rest does. Being pulled over is pure
  // downside, never a break in disguise.
  const cost = hosCost(round.sinceRest, driveMin + caughtMin);
  round.hops.push({
    from: round.at, to, km: edge.km, driveMin, pushed: push, caught, caughtMin,
    breakMin: cost.charged - driveMin - caughtMin, min: cost.charged,
  });
  round.spent += cost.charged;
  round.km += edge.km;
  round.sinceRest = cost.sinceRest;
  round.at = to;
  round.visited.add(to);
  if (to === round.target) round.finished = true;
  else if (options(g, round).length === 0) { round.finished = true; round.deadEnd = true; }
  return round;
}

export const remaining = (round) => round.budget - round.spent;

// --- the corridor bet, made comparable --------------------------------
// The current hop's pace tier is exact — it's drawn that way. What's still
// unknown is exactly how fast the "ordinary" 65-85 km/h stretch of it runs.
// ASSUMED_KMH is a nominal midpoint per tier, used only to estimate that —
// the same judgement a player is already asked to make from the drawn line
// weight, just doing the arithmetic instead of leaving it to be eyeballed.
const ASSUMED_KMH = [50, 75, 95]; // slow, ordinary, motorway

/** A rough, honestly-labelled minutes estimate for a hop not yet taken. */
export function estimateHopMinutes(edge) {
  const mix = paceMix(edge);
  const kmh = mix[0] * ASSUMED_KMH[0] + mix[1] * ASSUMED_KMH[1] + mix[2] * ASSUMED_KMH[2];
  return (edge.km / kmh) * 60;
}

/**
 * Budget remaining ÷ crow-flies distance to the target, from wherever the
 * player is actually standing. Pure arithmetic on numbers already on
 * screen — it can't leak a single road's speed. A floor, not a promise:
 * real roads run longer than the straight line.
 */
export function requiredPace(g, round) {
  const left = remaining(round);
  if (left <= 0) return Infinity;
  return crow(g, round.at, round.target) / (left / 60);
}

/**
 * What requiredPace becomes if the player takes a specific hop next — an
 * ESTIMATE (built on estimateHopMinutes), not a promise, since the real
 * minutes a hop costs are still hidden until it's actually taken. Lets a
 * player compare candidates side by side instead of holding the arithmetic
 * for each one in their head.
 */
export function previewPace(g, round, to) {
  const edge = g.adj[round.at].find((e) => e.to === to);
  if (!edge) return null;
  // The driving-hours clock is the player's own status, not a fact about the
  // road — same visibility tier as the budget itself — so the preview is
  // fair to account for it, using the same estimated minutes it already
  // guesses everything else with.
  const cost = hosCost(round.sinceRest, estimateHopMinutes(edge));
  const leftAfter = remaining(round) - cost.charged;
  if (leftAfter <= 0) return Infinity;
  return crow(g, to, round.target) / (leftAfter / 60);
}

/** The same safe/tight/lost read the pace-tier lines already use. */
export function paceRisk(kmh) {
  return kmh >= 85 ? 'lost' : kmh >= 65 ? 'tight' : 'ok';
}

/** Minutes as a driver reads them: 27h15. */
export function hhmm(minutes) {
  const sign = minutes < 0 ? '−' : '';
  const m = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

// The road's own pace — driving time only. A hop that happened to trigger a
// mandatory break shouldn't read as a slower road than it actually is;
// h.driveMin falls back to h.min for anything that predates the field.
export const speedOf = (h) => h.km / ((h.driveMin ?? h.min) / 60);

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
