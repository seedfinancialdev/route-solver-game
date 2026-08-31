// scripts/build-blind-map-candidates.mjs
//
// Generates blind-map/candidates.json from the real road graph — the small,
// hand-curated set of junctions the map-legibility test cycles through. Not
// the automated destination-first generator (that's a later build-sequence
// phase); this is just "find a few real, diverse junctions to look at."
//
// Usage: node scripts/build-blind-map-candidates.mjs

import { writeFileSync } from 'node:fs';
import { loadGraph } from './lib/road-graph.mjs';
import { pickCandidates } from '../blind-map/candidates.mjs';

// Round to 5 decimal places (~1.1m) before writing: the graph's underlying
// coordinates are a Float32Array, whose real precision is only about
// 0.1-0.8m, so the raw float64 string expansion (e.g. 10.783414840698242)
// looks far more precise than the data actually is. Harmless at a 300m fog
// radius, but 5dp is more than enough and matches the data's real precision.
const round5 = (n) => Math.round(n * 1e5) / 1e5;

const g = loadGraph('data/road-graph');
const candidates = pickCandidates(g, { count: 8, minDegree: 3 });
const out = candidates.map(({ lon, lat, classes }) => ({ lon: round5(lon), lat: round5(lat), classes }));
writeFileSync(
  new URL('../blind-map/candidates.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`wrote ${out.length} candidates to blind-map/candidates.json`);
