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
