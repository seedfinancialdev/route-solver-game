// Shared graph utilities. Used by the puzzle finder, the terminal playtest and
// the browser game, so it stays dependency-free and side-effect-free.

import { haversineKm } from './geo.mjs';

export function buildGraph(data) {
  const { cities, edges } = data;
  const adj = cities.map(() => []);
  for (const e of edges) {
    adj[e.a].push({ to: e.b, km: e.km, min: e.min });
    adj[e.b].push({ to: e.a, km: e.km, min: e.min });
  }
  for (const list of adj) list.sort((x, y) => x.km - y.km);
  return { cities, edges, adj, n: cities.length };
}

/** Cheapest road cost from `src` to every city. Returns {dist, prev}. */
export function dijkstra(g, src, weight = (e) => e.km) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  const done = new Uint8Array(g.n);
  dist[src] = 0;
  // n is small enough (~185) that a linear scan beats a heap in both speed and
  // the amount of code you have to trust.
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

export function pathFrom(prev, src, dst) {
  const path = [];
  for (let v = dst; v !== -1; v = prev[v]) { path.push(v); if (v === src) break; }
  return path.reverse();
}

// --- endurance-racing rules: EU professional-driver hours (EC 561/2006) ----
// Real regulation, simplified for a turn-based game: 4.5 hours (270 min) of
// continuous driving forces a 45-minute break. The break is charged in whole
// units at hop boundaries — a hop that would cross one or more thresholds
// pays 45 min per threshold crossed, exact modular arithmetic, not just "a
// hop near the limit costs a bit more." What isn't modelled (yet): the daily
// 9h cap and 11h rest. That rule's cost (11 hours!) dwarfs a typical puzzle's
// whole budget — folding it in changes the game's pacing on a different
// order of magnitude and needs its own measurement pass, not a bolt-on.
export const HOS_CONTINUOUS_LIMIT = 270;
export const HOS_BREAK_MIN = 45;

/** Minutes actually charged for a hop, and the driving-clock state it leaves you in. */
export function hosCost(sinceRest, hopMin) {
  const total = sinceRest + hopMin;
  const breaks = Math.floor(total / HOS_CONTINUOUS_LIMIT);
  return { charged: hopMin + breaks * HOS_BREAK_MIN, sinceRest: total % HOS_CONTINUOUS_LIMIT, breaks };
}

/** Binary min-heap keyed by a numeric priority. Good enough to trust, small enough to read. */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, key) {
    const a = this.a;
    a.push([key, item]);
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

/**
 * The fastest *legal* route: Dijkstra over (city, minutes-since-last-break)
 * states rather than just city, since the same road can cost a hop's plain
 * minutes or that plus a mandatory 45-minute break depending on how much
 * continuous driving is already banked when you reach it — a genuinely
 * path-dependent cost, not something a plain shortest path can answer.
 * State space is g.n * HOS_CONTINUOUS_LIMIT, so this wants a real heap
 * (the plain dijkstra() above's linear scan assumes city-sized n).
 * Returns {distTo(dst), pathTo(dst)} rather than a flat array — with ~470
 * cities * 270 minute-states there's no reason to materialise the whole thing
 * when a puzzle only ever asks for one destination.
 */
export function hosDijkstra(g, src, dst) {
  const L = HOS_CONTINUOUS_LIMIT;
  const state = (city, rest) => city * L + rest;
  const dist = new Map();
  const prev = new Map();
  const start = state(src, 0);
  dist.set(start, 0);
  const heap = new MinHeap();
  heap.push(start, 0);
  const done = new Set();
  let bestState = -1, bestDist = Infinity;

  while (heap.size) {
    const u = heap.pop();
    if (done.has(u)) continue;
    done.add(u);
    const city = Math.floor(u / L), rest = u % L;
    if (city === dst) {
      // A state is only popped once its distance is finalised, so the very
      // first (dst, *) state popped — for any rest value — is the cheapest
      // arrival there is. No need to keep searching once we have it.
      bestState = u; bestDist = dist.get(u);
      break;
    }
    const d = dist.get(u);
    for (const e of g.adj[city]) {
      const { charged, sinceRest: newRest } = hosCost(rest, e.min);
      const v = state(e.to, newRest);
      const nd = d + charged;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        heap.push(v, nd);
      }
    }
  }

  if (bestState === -1) return { minutes: Infinity, path: [], stuck: true };

  const path = [];
  for (let v = bestState; v !== undefined; v = prev.get(v)) {
    path.push(Math.floor(v / L));
    if (v === start) break;
  }
  path.reverse();
  return { minutes: bestDist, path, stuck: false };
}

export function allPairsCost(g, weight) {
  return Array.from({ length: g.n }, (_, i) => dijkstra(g, i, weight).dist);
}

/**
 * What a player does before they learn anything: hop to whichever neighbour
 * looks closest to the target as the crow flies. Never revisits, because a
 * player wouldn't.
 */
export function greedyRoute(g, src, dst) {
  const seen = new Set([src]);
  const path = [src];
  let cost = 0, at = src;
  while (at !== dst) {
    let pick = -1, bestCrow = Infinity, pickKm = 0;
    for (const e of g.adj[at]) {
      if (seen.has(e.to)) continue;
      const crow = haversineKm(g.cities[e.to], g.cities[dst]);
      if (crow < bestCrow) { bestCrow = crow; pick = e.to; pickKm = e.km; }
    }
    if (pick === -1) return { cost: Infinity, path, stuck: true };
    seen.add(pick); path.push(pick); cost += pickKm; at = pick;
  }
  return { cost, path, stuck: false };
}

/**
 * How many distinct simple routes come in under `budget`. Counting stops at
 * `cap` — past a few dozen the exact number stops meaning anything, and the
 * search would blow up.
 */
export function countRoutesUnderBudget(g, src, dst, budget, costToDst, cap = 500) {
  let found = 0;
  const seen = new Uint8Array(g.n);
  (function walk(at, spent) {
    if (found >= cap) return;
    if (at === dst) { found++; return; }
    seen[at] = 1;
    for (const e of g.adj[at]) {
      if (seen[e.to]) continue;
      const next = spent + e.km;
      // A* style prune: no point walking on if the cheapest possible
      // completion already busts the budget.
      if (next + costToDst[e.to] <= budget) walk(e.to, next);
      if (found >= cap) break;
    }
    seen[at] = 0;
  }(src, 0));
  return found;
}
