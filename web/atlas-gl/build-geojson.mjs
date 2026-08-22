// Emits the small GeoJSON layers the atlas draws on top of the vector tiles.
//
// Roads are NOT here — every road is playable, so the map draws the real
// network straight from OSM tiles rather than from anything we generate.
// An earlier version converted the curated 2,160-edge network into pace runs
// for a highlight layer; that layer went away with the decision to make every
// road usable, and the tier algorithm still lives in scripts/05-bundle.mjs.
//
// Output: web/atlas-gl/cities.geojson, web/atlas-gl/runs.geojson

import { readFileSync, writeFileSync } from 'node:fs';

const r5 = (v) => Math.round(v * 1e5) / 1e5;

// ---- playable cities -------------------------------------------------------
const graph = JSON.parse(readFileSync(new URL('../../data/graph.json', import.meta.url), 'utf8'));
const cities = {
  type: 'FeatureCollection',
  features: graph.cities.map((c) => ({
    type: 'Feature',
    properties: { name: c.name, country: c.country, population: c.population || 0 },
    geometry: { type: 'Point', coordinates: [r5(c.lon), r5(c.lat)] },
  })),
};
writeFileSync(new URL('./cities.geojson', import.meta.url), JSON.stringify(cities));
console.log(`${cities.features.length} cities`);

// ---- career run endpoints --------------------------------------------------
const runs = JSON.parse(readFileSync(new URL('../../data/runs.json', import.meta.url), 'utf8'));
const endpoints = { type: 'FeatureCollection', features: [] };
for (const r of runs.runs) {
  for (const [role, p] of [['start', r.from], ['finish', r.to]]) {
    endpoints.features.push({
      type: 'Feature',
      properties: { run: r.id, runName: r.name, role, name: p.name, detail: p.detail },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    });
  }
}
writeFileSync(new URL('./runs.geojson', import.meta.url), JSON.stringify(endpoints));
console.log(`${runs.runs.length} career runs -> ${endpoints.features.length} endpoints`);
