// Phase 0, step 2: turn 194-odd city dots into a road graph.
//
// Candidate edges come from geometry (Delaunay + kNN). Real cost comes from
// OSRM. Anything OSRM can't route over tarmac stops being an edge.
//
// Output: data/graph.json — the only data file the game ships.

import { readFileSync, writeFileSync } from 'node:fs';
import { Delaunay } from 'd3-delaunay';
import { haversineKm } from './lib/geo.mjs';
import { project } from './lib/proj.mjs';
import { measurePairs } from './lib/osrm.mjs';

const SHAPE_TOLERANCE_KM = 0.06;  // thin the full road geometry to this before storing;
                                  // finer than any zoom the game offers, coarse enough
                                  // that data/graph.json stays a readable artefact

/** Douglas-Peucker in projected kilometres. */
function thin(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const a = points[lo], b = points[hi];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let worst = 0, at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i];
      const d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance && at !== -1) { keep[at] = 1; stack.push([lo, at], [at, hi]); }
  }
  return points.filter((_, i) => keep[i]);
}

const thinGeometry = (geometry) => {
  if (!geometry || geometry.length < 3) return geometry;
  const projectedPts = geometry.map(([lon, lat]) => ({ lon, lat, ...project(lon, lat) }));
  return thin(projectedPts, SHAPE_TOLERANCE_KM).map((p) => [p.lon, p.lat]);
};

const KNN = 5;
const MAX_CANDIDATE_KM = 350;   // straight-line; longer "neighbours" aren't neighbours
const MAX_EDGE_KM = 420;        // road. One hop shouldn't eat a fifth of a typical budget
const MAX_DETOUR_RATIO = 2.0;   // road/straight-line. Alpine passes run ~1.5
const MAX_FERRY_KM = 3;         // The Danube crossings OSRM prefers are ~1-2 km and have a
                                // bridge beside them, so they cost what a bridge costs. Every
                                // genuine sea link measured here is 5 km or more.
const PASS_THROUGH_KM = 12;     // A city this close to a road is, for our purposes, on it

const cities = JSON.parse(readFileSync(new URL('../data/cities.json', import.meta.url), 'utf8'));
const pts = cities.map((c) => { const p = project(c.lon, c.lat); return [p.x, p.y]; });

// --- candidate edges -------------------------------------------------------
// Delaunay for topology (every city gets neighbours in every direction),
// kNN on top so dense regions keep their short local hops.
const candidates = new Set();
const addPair = (a, b) => { if (a !== b) candidates.add(a < b ? `${a},${b}` : `${b},${a}`); };

const delaunay = Delaunay.from(pts);
for (let e = 0; e < delaunay.halfedges.length; e++) {
  if (e < delaunay.halfedges[e]) continue;
  addPair(delaunay.triangles[e], delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1]);
}
for (let i = 0; i < cities.length; i++) {
  const near = cities
    .map((c, j) => ({ j, km: haversineKm(cities[i], c) }))
    .filter((d) => d.j !== i)
    .sort((a, b) => a.km - b.km)
    .slice(0, KNN);
  for (const d of near) addPair(i, d.j);
}

const pairs = [...candidates]
  .map((s) => s.split(',').map(Number))
  .filter(([a, b]) => haversineKm(cities[a], cities[b]) <= MAX_CANDIDATE_KM);

console.log(`${pairs.length} candidate edges from Delaunay+kNN${KNN}`);

// --- road cost -------------------------------------------------------------
const jobs = pairs.map(([a, b]) => ({
  a: cities[a], b: cities[b], key: `${cities[a].geonameid}-${cities[b].geonameid}`,
}));
const measured = await measurePairs(jobs, (done, total) => {
  if (done % 100 === 0 || done === total) console.log(`  routed ${done}/${total}`);
});

// --- sanity filter ---------------------------------------------------------
const edges = [];
const rejected = { ferry: [], long: [], detour: [], noroute: [], through: [] };
pairs.forEach(([a, b], idx) => {
  const r = measured[idx];
  const label = `${cities[a].name}-${cities[b].name}`;
  if (!r || !r.km) { rejected.noroute.push(label); return; }
  const crow = haversineKm(cities[a], cities[b]);
  const ratio = r.km / crow;
  if (r.ferryKm > MAX_FERRY_KM) { rejected.ferry.push(`${label} (${r.ferryKm} km afloat)`); return; }
  if (r.km > MAX_EDGE_KM) { rejected.long.push(`${label} ${r.km.toFixed(0)} km`); return; }
  if (ratio > MAX_DETOUR_RATIO) { rejected.detour.push(`${label} ${ratio.toFixed(2)}x`); return; }
  edges.push({
    a, b, km: Math.round(r.km), min: Math.round(r.min),
    geometry: thinGeometry(r.geometry), steps: r.steps,
  });
});

// --- roads that drive straight through another city -------------------------
// The A4 from Rzeszów to Radom goes through Lublin, and Lublin is a city on this
// map. Keeping that as its own edge draws a road across a dot it does not stop
// at, and hands the player a hop that is really two hops glued together. The
// shortcut only goes if both of its halves exist, so nothing is cut off by it.
const surviving = new Set(edges.map((e) => `${Math.min(e.a, e.b)},${Math.max(e.a, e.b)}`));
const key = (a, b) => `${Math.min(a, b)},${Math.max(a, b)}`;
const projected = cities.map((c) => project(c.lon, c.lat));

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const throughCity = (edge) => {
  const shape = (edge.geometry || []).map(([lon, lat]) => project(lon, lat));
  if (shape.length < 2) return null;
  for (let c = 0; c < cities.length; c++) {
    if (c === edge.a || c === edge.b) continue;
    let d = Infinity;
    for (let i = 1; i < shape.length && d >= PASS_THROUGH_KM; i++) {
      d = Math.min(d, distToSegment(projected[c], shape[i - 1], shape[i]));
    }
    if (d < PASS_THROUGH_KM && surviving.has(key(edge.a, c)) && surviving.has(key(c, edge.b))) return c;
  }
  return null;
};

const direct = [];
for (const e of edges) {
  const via = throughCity(e);
  if (via === null) direct.push(e);
  else rejected.through.push(`${cities[e.a].name}-${cities[e.b].name} runs through ${cities[via].name}`);
}
edges.length = 0;
edges.push(...direct);

// --- connectivity ----------------------------------------------------------
// Whatever is left over after the filters is by definition unreachable by road,
// so it leaves the game: islands, and anything hanging off a single ferry.
const adj = cities.map(() => []);
for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }

const comp = new Array(cities.length).fill(-1);
const sizes = [];
for (let s = 0; s < cities.length; s++) {
  if (comp[s] !== -1) continue;
  const id = sizes.length; let n = 0; const stack = [s]; comp[s] = id;
  while (stack.length) {
    const v = stack.pop(); n++;
    for (const w of adj[v]) if (comp[w] === -1) { comp[w] = id; stack.push(w); }
  }
  sizes.push(n);
}
const main = sizes.indexOf(Math.max(...sizes));

const keep = cities.filter((c) => comp[c.i] === main);
const remap = new Map(keep.map((c, i) => [c.i, i]));
const outCities = keep.map((c, i) => ({ ...c, i }));
const outEdges = edges
  .filter((e) => comp[e.a] === main)
  .map((e) => ({
    a: remap.get(e.a), b: remap.get(e.b), km: e.km, min: e.min,
    geometry: e.geometry, steps: e.steps,
  }))
  .sort((x, y) => x.a - y.a || x.b - y.b);

writeFileSync(
  new URL('../data/graph.json', import.meta.url),
  JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    source: { cities: 'GeoNames cities15000', routing: 'OSRM driving profile' },
    cities: outCities, edges: outEdges,
  }) + '\n',
);

const deg = outCities.map(() => 0);
for (const e of outEdges) { deg[e.a]++; deg[e.b]++; }
const km = outEdges.map((e) => e.km).sort((a, b) => a - b);
const q = (p) => km[Math.floor(km.length * p)];

console.log(`\nkept ${outCities.length} cities, ${outEdges.length} edges`);
console.log(`components: ${sizes.slice().sort((a, b) => b - a).join(', ')}`);
console.log(`dropped: ${cities.filter((c) => comp[c.i] !== main).map((c) => c.name).join(', ') || '(none)'}`);
console.log(`degree min/mean/max: ${Math.min(...deg)}/${(deg.reduce((a, b) => a + b, 0) / deg.length).toFixed(1)}/${Math.max(...deg)}`);
console.log(`hop km p10/p50/p90: ${q(0.1)}/${q(0.5)}/${q(0.9)}`);
for (const [why, list] of Object.entries(rejected)) {
  if (!list.length) continue;
  console.log(`\nrejected ${list.length} (${why}): ${list.slice(0, 12).join('; ')}${list.length > 12 ? ' ...' : ''}`);
}
