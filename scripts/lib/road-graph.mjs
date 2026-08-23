// Loader and router for the binary road graph built by scripts/14-road-graph.py.
//
// The graph carries no geometry — the router does not need it, and the map
// draws roads from vector tiles. What is here is topology, length, speed and
// the flags the cost model reads.

import { readFileSync } from 'node:fs';

export function loadGraph(dir) {
  const read = (name, Type) => {
    const buf = readFileSync(new URL(`${dir}/${name}`, import.meta.url).pathname.startsWith('/')
      ? `${dir}/${name}` : `${dir}/${name}`);
    return new Type(buf.buffer, buf.byteOffset, buf.byteLength / Type.BYTES_PER_ELEMENT);
  };
  const meta = JSON.parse(readFileSync(`${dir}/graph.meta.json`, 'utf8'));
  const g = {
    meta,
    xy: read('graph.nodes.bin', Float32Array),      // lon,lat interleaved
    a: read('graph.edges.a.bin', Int32Array),
    b: read('graph.edges.b.bin', Int32Array),
    m: read('graph.edges.m.bin', Uint32Array),
    kmh: read('graph.edges.kmh.bin', Uint8Array),
    cls: read('graph.edges.cls.bin', Uint8Array),
    flags: read('graph.edges.flags.bin', Uint8Array),
    n: meta.nodes,
    e: meta.edges,
  };
  buildCsr(g);
  buildIndex(g);
  return g;
}

/**
 * Compressed sparse row adjacency, built at load rather than stored — it takes
 * well under a second and storing it would double the artifact.
 *
 * A one-way edge is inserted forward only. Everything else goes both ways.
 */
function buildCsr(g) {
  const ONEWAY = g.meta.flags.oneway;
  const deg = new Uint32Array(g.n + 1);
  for (let i = 0; i < g.e; i++) {
    deg[g.a[i]]++;
    if (!(g.flags[i] & ONEWAY)) deg[g.b[i]]++;
  }
  const off = new Uint32Array(g.n + 1);
  for (let i = 0; i < g.n; i++) off[i + 1] = off[i] + deg[i];
  const total = off[g.n];
  const to = new Int32Array(total);
  const via = new Uint32Array(total);
  const cursor = off.slice();
  for (let i = 0; i < g.e; i++) {
    const u = g.a[i], v = g.b[i];
    to[cursor[u]] = v; via[cursor[u]] = i; cursor[u]++;
    if (!(g.flags[i] & ONEWAY)) { to[cursor[v]] = u; via[cursor[v]] = i; cursor[v]++; }
  }
  g.off = off; g.to = to; g.via = via;
}

/** Coarse grid index, good enough to snap a lat/lon to the nearest node. */
function buildIndex(g, cell = 0.05) {
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (let i = 0; i < g.n; i++) {
    const k = key(g.xy[2 * i], g.xy[2 * i + 1]);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  g.grid = grid; g.cell = cell;
}

export function nearestNode(g, lon, lat) {
  const c = g.cell;
  const cx = Math.floor(lon / c), cy = Math.floor(lat / c);
  let best = -1, bestD = Infinity;
  for (let ring = 0; ring < 40 && best < 0; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        for (const i of g.grid.get(`${cx + dx}:${cy + dy}`) || []) {
          const d = (g.xy[2 * i] - lon) ** 2 + (g.xy[2 * i + 1] - lat) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    if (best >= 0 && ring < 2) continue;   // widen once, so we don't take a bad first hit
  }
  return best;
}

/** Minutes to traverse an edge. This is the game's cost model, not OSRM's. */
export const travelMinutes = (g, i) => (g.m[i] / 1000) / g.kmh[i] * 60;

class Heap {
  constructor() { this.k = [0]; this.v = [0]; this.size = 0; }
  push(key, val) {
    let i = ++this.size;
    this.k[i] = key; this.v[i] = val;
    while (i > 1) {
      const p = i >> 1;
      if (this.k[p] <= this.k[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop() {
    const topK = this.k[1], topV = this.v[1];
    this.k[1] = this.k[this.size]; this.v[1] = this.v[this.size];
    this.size--;
    let i = 1;
    for (;;) {
      const l = i << 1, r = l + 1;
      let s = i;
      if (l <= this.size && this.k[l] < this.k[s]) s = l;
      if (r <= this.size && this.k[r] < this.k[s]) s = r;
      if (s === i) break;
      [this.k[s], this.k[i]] = [this.k[i], this.k[s]];
      [this.v[s], this.v[i]] = [this.v[i], this.v[s]];
      i = s;
    }
    return [topK, topV];
  }
}

/**
 * Shortest path by minutes, or by metres when `byDistance` is set. `penalty`
 * optionally multiplies specific edges, which is how alternative corridors get
 * found — see corridors() below. The returned `minutes` is always real travel
 * time, whatever the search was weighted by.
 */
export function route(g, src, dst, penalty = null, byDistance = false) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prevNode = new Int32Array(g.n).fill(-1);
  const prevEdge = new Int32Array(g.n).fill(-1);
  const done = new Uint8Array(g.n);
  const heap = new Heap();
  dist[src] = 0;
  heap.push(0, src);

  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === dst) break;
    for (let k = g.off[u]; k < g.off[u + 1]; k++) {
      const v = g.to[k], i = g.via[k];
      if (done[v]) continue;
      // byDistance costs the SHORTEST route, not the fastest — the game's
      // thesis is that those differ, and the gate measures by how much.
      const w = byDistance ? g.m[i] : travelMinutes(g, i) * (penalty ? penalty[i] : 1);
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prevNode[v] = u; prevEdge[v] = i; heap.push(nd, v); }
    }
  }
  if (!Number.isFinite(dist[dst])) return null;

  const edges = [];
  for (let v = dst; v !== src && prevEdge[v] >= 0; v = prevNode[v]) edges.push(prevEdge[v]);
  edges.reverse();
  let minutes = 0, metres = 0;
  for (const i of edges) { minutes += travelMinutes(g, i); metres += g.m[i]; }
  return { edges, minutes, km: metres / 1000, set: new Set(edges) };
}

/**
 * Distinct corridors, by iterative penalised Dijkstra.
 *
 * Plain "alternative routes" search is local and finds nothing at continental
 * scale — the public OSRM demo returned one corridor for a 4,132 km run.
 * Penalising the accepted corridors and re-routing is what actually surfaces
 * a genuinely different way round.
 */
export function corridors(g, src, dst, { tolerance = 1.20, maxOverlap = 0.65, rounds = 10, penalty = 1.6 } = {}) {
  const best = route(g, src, dst);
  if (!best) return [];
  const mult = new Float64Array(g.e).fill(1);
  for (const i of best.edges) mult[i] *= penalty;
  const accepted = [best];

  for (let r = 0; r < rounds; r++) {
    const alt = route(g, src, dst, mult);
    if (!alt) break;
    if (alt.minutes <= best.minutes * tolerance) {
      const distinct = accepted.every((p) => {
        let shared = 0;
        for (const i of alt.set) if (p.set.has(i)) shared += g.m[i];
        return shared / (alt.km * 1000) < maxOverlap;
      });
      if (distinct) accepted.push(alt);
    }
    for (const i of alt.edges) mult[i] *= penalty;
  }
  return accepted;
}
