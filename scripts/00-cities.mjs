// Phase 0, step 1: pick the city set from GeoNames cities15000.
//
// Input:  data/raw/cities15000.txt (GeoNames tab-separated dump)
// Output: data/cities.json
//
// Rules: European countries only, top N by population, but no two cities
// closer than MIN_SPACING_KM. Without the spacing rule you get the Ruhr,
// Randstad and Upper Silesia eating half the budget and no Iberia.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { haversineKm } from './lib/geo.mjs';
import { inGameEurope, parseRow } from './lib/cities.mjs';

const TARGET_COUNT = 500;
const MIN_SPACING_KM = 75;

const raw = readFileSync(new URL('../data/raw/cities15000.txt', import.meta.url), 'utf8');

const candidates = [];
for (const line of raw.split('\n')) {
  if (!line) continue;
  const row = parseRow(line);
  if (!inGameEurope(row)) continue;
  candidates.push({
    id: row.id, name: row.name, country: row.country, lat: row.lat, lon: row.lon, population: row.population,
  });
}

candidates.sort((a, b) => b.population - a.population);

const picked = [];
for (const c of candidates) {
  if (picked.length >= TARGET_COUNT) break;
  const tooClose = picked.some((p) => haversineKm(p, c) < MIN_SPACING_KM);
  if (!tooClose) picked.push(c);
}

// Stable ids: index into this array is what every later file refers to.
picked.sort((a, b) => a.name.localeCompare(b.name, 'en'));
const cities = picked.map((c, i) => ({
  i, name: c.name, country: c.country, geonameid: c.id,
  lat: Number(c.lat.toFixed(4)), lon: Number(c.lon.toFixed(4)), population: c.population,
}));

mkdirSync(new URL('../data', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/cities.json', import.meta.url), JSON.stringify(cities, null, 0) + '\n');

const byCountry = {};
for (const c of cities) byCountry[c.country] = (byCountry[c.country] || 0) + 1;
console.log(`${cities.length} cities from ${candidates.length} candidates, spacing >= ${MIN_SPACING_KM} km`);
console.log(Object.entries(byCountry).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log(`smallest kept: ${cities.reduce((a, b) => (a.population < b.population ? a : b)).name}`);
