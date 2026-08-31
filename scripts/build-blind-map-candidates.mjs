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

const g = loadGraph('data/road-graph');
const candidates = pickCandidates(g, { count: 8, minDegree: 3 });
const out = candidates.map(({ lon, lat, classes }) => ({ lon, lat, classes }));
writeFileSync(
  new URL('../blind-map/candidates.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`wrote ${out.length} candidates to blind-map/candidates.json`);
