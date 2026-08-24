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
  findMainComponent(g);
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

/**
 * Flood-fill the largest connected component.
 *
 * Snapping has to ignore everything outside it. With residential roads in the
 * graph the nearest node to a landmark is frequently a disconnected stub — a
 * severed service road, a fragment by a headland — and routing from it fails
 * outright. Punta de Tarifa did exactly this: it snapped 390 m to an isolated
 * node and Cape to Cape became unroutable, having worked fine on the smaller
 * spine graph where no such node was nearby.
 */
function findMainComponent(g) {
  const comp = new Int32Array(g.n).fill(-1);
  const stack = new Int32Array(g.n);
  let best = -1, bestSize = 0, id = 0;
  for (let start = 0; start < g.n; start++) {
    if (comp[start] !== -1) continue;
    let top = 0, size = 0;
    stack[top++] = start;
    comp[start] = id;
    while (top) {
      const u = stack[--top];
      size++;
      for (let k = g.off[u]; k < g.off[u + 1]; k++) {
        const v = g.to[k];
        if (comp[v] === -1) { comp[v] = id; stack[top++] = v; }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  g.comp = comp;
  g.mainComp = best;
  g.mainSize = bestSize;
  g.components = id;
}

/** Coarse grid index, good enough to snap a lat/lon to the nearest node. */
function buildIndex(g, cell = 0.05) {
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (let i = 0; i < g.n; i++) {
    // Only the main component is snappable — see findMainComponent.
    if (g.comp[i] !== g.mainComp) continue;
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

/**
 * Snap a landmark to a junction you can actually drive out of.
 *
 * nearestNode() takes whatever is closest, and in a city centre that is often a
 * one-way sink — reachable, with no outgoing edge. Vienna's nearest node to the
 * centre had out-degree 0, so every checkpoint ordering that put Vienna in the
 * middle was unroutable, and the count gate quietly dropped those races instead
 * of reporting them.
 *
 * Out-degree three or more also excludes cul-de-sacs and mid-block nodes, which
 * makes the point deterministic: every player running the race gets the same
 * intersection.
 */
export function junctionNode(g, lon, lat, { minDegree = 3, radiusKm = 5 } = {}) {
  const rings = Math.max(1, Math.ceil((radiusKm / 111) / g.cell));
  const cx = Math.floor(lon / g.cell), cy = Math.floor(lat / g.cell);
  let best = -1, bestD = Infinity;
  for (let dx = -rings; dx <= rings; dx++) {
    for (let dy = -rings; dy <= rings; dy++) {
      for (const i of g.grid.get(`${cx + dx}:${cy + dy}`) || []) {
        if (g.off[i + 1] - g.off[i] < minDegree) continue;
        const d = (g.xy[2 * i] - lon) ** 2 + (g.xy[2 * i + 1] - lat) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
  }
  return best >= 0 ? best : nearestNode(g, lon, lat);
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

/**
 * Travel minutes from one node to every other. Same search as route(), without
 * the early exit.
 *
 * A checkpoint run needs the cost of every leg between every pair. Calling
 * route() for each pair is O(n^2) searches; one full sweep per checkpoint is
 * O(n), which is the difference between 81 searches and 9 on an eight-point
 * circuit.
 */
export function timesFrom(g, src) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const done = new Uint8Array(g.n);
  const heap = new Heap();
  dist[src] = 0;
  heap.push(0, src);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    for (let k = g.off[u]; k < g.off[u + 1]; k++) {
      const v = g.to[k];
      if (done[v]) continue;
      const nd = d + travelMinutes(g, g.via[k]);
      if (nd < dist[v]) { dist[v] = nd; heap.push(nd, v); }
    }
  }
  return dist;
}

/**
 * Arrival time at every node, leaving `src` at `departMinutes`.
 *
 * The time-dependent twin of timesFrom(). A checkpoint run needs the cost of
 * every ordered pair of stops at every departure hour, and routeTimed() answers
 * one pair per search — 43 pairs across 8 hours is 344 continental searches.
 * One sweep per source answers every destination at once, so the same matrix
 * costs 64.
 *
 * Correct for the same reason routeTimed() is: `dist[u]` is arrival time, and
 * the congestion model is FIFO, so leaving later never gets you there earlier.
 *
 * @param timeCost (edgeIndex, clockMinutes) -> minutes to traverse
 */
export function timesFromTimed(g, src, departMinutes, timeCost) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const done = new Uint8Array(g.n);
  const heap = new Heap();
  dist[src] = 0;
  heap.push(0, src);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    const clock = departMinutes + d;
    for (let k = g.off[u]; k < g.off[u + 1]; k++) {
      const v = g.to[k];
      if (done[v]) continue;
      const nd = d + timeCost(g.via[k], clock);
      if (nd < dist[v]) { dist[v] = nd; heap.push(nd, v); }
    }
  }
  return dist;
}

/**
 * Cheapest order to visit `stops` between a fixed first and last node.
 *
 * Brute force over permutations of the middle. A circuit's decision is
 * sequencing rather than corridor choice, so this is what its difficulty
 * actually rests on — and with the handful of checkpoints a run carries, exact
 * beats approximate.
 */
export function bestOrder(matrix, n) {
  const middle = [];
  for (let i = 1; i < n - 1; i++) middle.push(i);
  let best = null, bestCost = Infinity, worstCost = 0;
  const costs = [];
  const permute = (arr, k = 0) => {
    if (k === arr.length) {
      const order = [0, ...arr, n - 1];
      let cost = 0;
      for (let i = 1; i < order.length; i++) cost += matrix[order[i - 1]][order[i]];
      costs.push(cost);
      if (cost < bestCost) { bestCost = cost; best = order.slice(); }
      if (cost > worstCost) worstCost = cost;
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(middle);
  // What a competent player actually does: take the nearest unvisited stop
  // each time. If that lands on the optimum, the sequencing "decision" is
  // obvious and the run is a formality however much variance the full
  // permutation set shows — a coastal ring is the clear case.
  const seen = new Set([0, n - 1]);
  let at = 0, greedy = 0;
  while (seen.size < n) {
    let next = -1, bestLeg = Infinity;
    for (let i = 1; i < n - 1; i++) {
      if (seen.has(i)) continue;
      if (matrix[at][i] < bestLeg) { bestLeg = matrix[at][i]; next = i; }
    }
    greedy += bestLeg; seen.add(next); at = next;
  }
  greedy += matrix[at][n - 1];

  costs.sort((a, b) => a - b);
  return {
    greedy,
    order: best,
    minutes: bestCost,
    worst: worstCost,
    // The median ordering is what an uninformed player lands on. Best-vs-median
    // is the size of the decision; best-vs-authored only tests the author.
    median: costs[Math.floor(costs.length / 2)],
    permutations: costs.length,
  };
}

/**
 * Shortest path where an edge's cost depends on WHEN you reach it.
 *
 * `dist[u]` is the arrival time at u in minutes from departure, so the clock at
 * any edge is departMinutes + dist[u]. That makes the search time-dependent
 * without a second dimension of state, which is only valid because the
 * congestion model is FIFO — leaving later never gets you there earlier.
 *
 * This is the search that can reverse a corridor ranking. The static one cannot:
 * with no time in the world, the motorway wins on every axis at once.
 *
 * @param timeCost (edgeIndex, clockMinutes) -> minutes to traverse
 */
export function routeTimed(g, src, dst, departMinutes, timeCost, penalty = null) {
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
    const clock = departMinutes + d;
    for (let k = g.off[u]; k < g.off[u + 1]; k++) {
      const v = g.to[k], i = g.via[k];
      if (done[v]) continue;
      const w = timeCost(i, clock) * (penalty ? penalty[i] : 1);
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prevNode[v] = u; prevEdge[v] = i; heap.push(nd, v); }
    }
  }
  if (!Number.isFinite(dist[dst])) return null;

  const edges = [];
  for (let v = dst; v !== src && prevEdge[v] >= 0; v = prevNode[v]) edges.push(prevEdge[v]);
  edges.reverse();
  let metres = 0;
  for (const i of edges) metres += g.m[i];
  return { edges, minutes: dist[dst], km: metres / 1000, set: new Set(edges) };
}
