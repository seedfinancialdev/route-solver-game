// Stand-in players, used to calibrate the budget multiplier.
//
// The point of all of them: a player cannot see road distance before they
// commit. They see dots on a blank map, so they can estimate straight-line
// distance and nothing else. Every bot below is restricted to that, except
// `oracle`, which is the engine and is allowed to cheat.

import { haversineKm } from '../scripts/lib/geo.mjs';
import { dijkstra, pathFrom } from '../scripts/lib/graph.mjs';

const crow = (g, i, j) => haversineKm(g.cities[i], g.cities[j]);

/** Walks a step-by-step policy until it lands, gets stuck, or loops out. */
function walk(g, src, dst, choose) {
  const visited = new Set([src]);
  const path = [src];
  let cost = 0, minutes = 0, at = src;
  while (at !== dst) {
    const options = g.adj[at].filter((e) => !visited.has(e.to));
    if (!options.length) return { cost: Infinity, path, stuck: true };
    const pick = choose(at, options, dst);
    cost += pick.km; minutes += pick.min;
    at = pick.to; visited.add(at); path.push(at);
    if (path.length > g.n) return { cost: Infinity, path, stuck: true };
  }
  return { cost, minutes, path, stuck: false };
}

/** Hop to whatever dot sits closest to the target. Ignores what the hop costs. */
export function naive(g, src, dst) {
  return walk(g, src, dst, (at, opts) =>
    opts.reduce((best, e) => (crow(g, e.to, dst) < crow(g, best.to, dst) ? e : best)));
}

/**
 * One-ply: weigh the hop you're about to pay for against the ground it gains.
 * This is what a thoughtful first-time player does.
 */
export function estimator(g, src, dst) {
  const score = (at, e) => crow(g, at, e.to) + crow(g, e.to, dst);
  return walk(g, src, dst, (at, opts) =>
    opts.reduce((best, e) => (score(at, e) < score(at, best) ? e : best)));
}

/**
 * Plans a whole corridor on the information the map actually shows: shortest
 * path through the graph using straight-line distances as the edge weights.
 * This is the ceiling for a player who can see the dots and reason well, and
 * the gap between what it plans and what it pays is the terrain tax — the
 * thing the game is teaching.
 */
export function planner(g, src, dst) {
  // Dijkstra over crow-weighted edges, replanned at each step so the bot
  // behaves like someone re-reading the map after every hop.
  const visited = new Set([src]);
  const path = [src];
  let cost = 0, minutes = 0, at = src;
  while (at !== dst) {
    const plan = crowDijkstra(g, at, visited);
    let next = dst, guard = 0;
    while (plan.prev[next] !== at && plan.prev[next] !== -1 && guard++ < g.n) next = plan.prev[next];
    const edge = g.adj[at].find((e) => e.to === next && !visited.has(e.to));
    if (!edge) return { cost: Infinity, path, stuck: true };
    cost += edge.km; minutes += edge.min;
    at = edge.to; visited.add(at); path.push(at);
  }
  return { cost, minutes, path, stuck: false };
}

function crowDijkstra(g, src, visited) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  const done = new Uint8Array(g.n);
  for (const v of visited) if (v !== src) done[v] = 1;
  dist[src] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < g.n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u === -1) break;
    done[u] = 1;
    for (const e of g.adj[u]) {
      const d = dist[u] + crow(g, u, e.to);
      if (d < dist[e.to]) { dist[e.to] = d; prev[e.to] = u; }
    }
  }
  return { dist, prev };
}

/** The engine's answer. No player ever needs to find this. */
export function oracle(g, src, dst) {
  const { dist, prev } = dijkstra(g, src);
  const path = pathFrom(prev, src, dst);
  let minutes = 0;
  for (let i = 1; i < path.length; i++) {
    minutes += g.adj[path[i - 1]].find((e) => e.to === path[i]).min;
  }
  return { cost: dist[dst], minutes, path, stuck: false };
}

export const BOTS = { naive, estimator, planner, oracle };

// --- a plausible human -----------------------------------------------------
// `planner` runs an exact search over 185 cities in its head, which nobody
// does. This one is the model the budget is actually tuned against: it looks a
// few hops ahead, estimates the rest of the trip as a straight line, and
// misjudges every distance a little. The misjudgement is fixed per edge for
// the whole run — people are consistently wrong about a given stretch, not
// randomly wrong each time they look at it.

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (rng) =>
  Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

export function humanish(g, src, dst, { seed = 1, sigma = 0.12, horizon = 3 } = {}) {
  const rng = mulberry32(seed);
  const bias = new Map();
  const seen = (i, j) => {
    const k = i < j ? `${i},${j}` : `${j},${i}`;
    if (!bias.has(k)) bias.set(k, Math.exp(gaussian(rng) * sigma));
    return crow(g, i, j) * bias.get(k);
  };

  const visited = new Set([src]);
  const path = [src];
  let cost = 0, minutes = 0, at = src;

  while (at !== dst) {
    // Look `horizon` hops ahead, then assume the remainder is a straight line.
    let bestFirst = null, bestScore = Infinity;
    const search = (node, depth, spent, first) => {
      const score = spent + seen(node, dst);
      if (node === dst || depth === 0) {
        if (score < bestScore) { bestScore = score; bestFirst = first; }
        return;
      }
      for (const e of g.adj[node]) {
        if (visited.has(e.to) || (first !== null && e.to === first && depth < horizon)) continue;
        search(e.to, depth - 1, spent + seen(node, e.to), first ?? e.to);
      }
    };
    for (const e of g.adj[at]) {
      if (visited.has(e.to)) continue;
      search(e.to, horizon - 1, seen(at, e.to), e.to);
    }
    if (bestFirst === null) return { cost: Infinity, path, stuck: true };
    const edge = g.adj[at].find((e) => e.to === bestFirst);
    cost += edge.km; minutes += edge.min;
    at = edge.to; visited.add(at); path.push(at);
  }
  return { cost, minutes, path, stuck: false };
}

// --- players for a time budget ---------------------------------------------
// The regime changed: the roads are drawn now, so a player can judge distance
// well. What they cannot judge is speed. These models get distance for free and
// have to guess how fast each road runs.

const shortestPath = (g, src, dst, weight) => {
  const { prev } = dijkstra(g, src, weight);
  return pathFrom(prev, src, dst);
};

const timeOf = (g, path) => {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += g.adj[path[i - 1]].find((e) => e.to === path[i]).min;
  return m;
};

/** Takes the shortest road, every time. The trap the drawn map sets. */
export function shortestRouter(g, src, dst) {
  const path = shortestPath(g, src, dst, (e) => e.km);
  return { minutes: timeOf(g, path), km: path.reduce((t, v, i) => (
    i ? t + g.adj[path[i - 1]].find((e) => e.to === v).km : 0), 0), path, stuck: false };
}

/** The engine's answer: the genuinely fastest way. */
export function fastest(g, src, dst) {
  const path = shortestPath(g, src, dst, (e) => e.min);
  return { minutes: timeOf(g, path), path, stuck: false };
}

/**
 * Someone reading the roads: they see each hop's length exactly, and they form
 * a view on how fast it runs — from how the road is drawn, from knowing the
 * country — but that view is off by a consistent amount per road. They look a
 * few hops ahead and estimate the rest of the trip at a plain average speed.
 */
export function roadReader(g, src, dst, {
  seed = 1, sigma = 0.18, nearSigma = null, horizon = 3, assumedKmh = 80,
} = {}) {
  const rng = mulberry32(seed);
  const bias = new Map();
  // `nearSigma` models the game as it is now: the roads out of the city you are
  // standing in are drawn weighted by how fast they run, so the next hop is
  // judged well. Everything past it is still guesswork.
  const guessMin = (from, to, e, near) => {
    const s = near && nearSigma != null ? nearSigma : sigma;
    const k = `${near ? 'n' : 'f'}:${from < to ? `${from},${to}` : `${to},${from}`}`;
    if (!bias.has(k)) bias.set(k, Math.exp(gaussian(rng) * s));
    return e.min * bias.get(k);
  };
  const restOfTrip = (node) => (haversineKm(g.cities[node], g.cities[dst]) / assumedKmh) * 60;

  const visited = new Set([src]);
  const path = [src];
  let minutes = 0, km = 0, at = src;

  while (at !== dst) {
    let bestFirst = null, bestScore = Infinity;
    const search = (node, depth, spent, first) => {
      const score = spent + restOfTrip(node);
      if (node === dst || depth === 0) {
        if (score < bestScore) { bestScore = score; bestFirst = first; }
        return;
      }
      for (const e of g.adj[node]) {
        if (visited.has(e.to)) continue;
        search(e.to, depth - 1, spent + guessMin(node, e.to, e, false), first ?? e.to);
      }
    };
    for (const e of g.adj[at]) {
      if (visited.has(e.to)) continue;
      search(e.to, horizon - 1, guessMin(at, e.to, e, true), e.to);
    }
    if (bestFirst === null) return { minutes: Infinity, km, path, stuck: true };
    const edge = g.adj[at].find((e) => e.to === bestFirst);
    minutes += edge.min; km += edge.km;
    at = edge.to; visited.add(at); path.push(at);
  }
  return { minutes, km, path, stuck: false };
}
