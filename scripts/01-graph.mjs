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

const KNN = 5;
const MAX_CANDIDATE_KM = 350;   // straight-line; longer "neighbours" aren't neighbours
const MAX_EDGE_KM = 420;        // road. One hop shouldn't eat a fifth of a typical budget
const MAX_DETOUR_RATIO = 2.0;   // road/straight-line. Alpine passes run ~1.5
const MAX_FERRY_KM = 3;         // The Danube crossings OSRM prefers are ~1-2 km and have a
                                // bridge beside them, so they cost what a bridge costs. Every
                                // genuine sea link measured here is 5 km or more.

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
const rejected = { ferry: [], long: [], detour: [], noroute: [] };
pairs.forEach(([a, b], idx) => {
  const r = measured[idx];
  const label = `${cities[a].name}-${cities[b].name}`;
  if (!r || !r.km) { rejected.noroute.push(label); return; }
  const crow = haversineKm(cities[a], cities[b]);
  const ratio = r.km / crow;
  if (r.ferryKm > MAX_FERRY_KM) { rejected.ferry.push(`${label} (${r.ferryKm} km afloat)`); return; }
  if (r.km > MAX_EDGE_KM) { rejected.long.push(`${label} ${r.km.toFixed(0)} km`); return; }
  if (ratio > MAX_DETOUR_RATIO) { rejected.detour.push(`${label} ${ratio.toFixed(2)}x`); return; }
  edges.push({ a, b, km: Math.round(r.km), min: Math.round(r.min) });
});

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
  .map((e) => ({ a: remap.get(e.a), b: remap.get(e.b), km: e.km, min: e.min }))
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
