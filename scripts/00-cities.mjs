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

const TARGET_COUNT = 500;
const MIN_SPACING_KM = 75;

// The continental landmass only. Britain and Ireland are excluded along with
// Iceland/Malta/Cyprus: every route onto them runs through a ferry or the
// Chunnel, and a sea hop is exactly the cost a player cannot reason about from
// a boundary map. Sicily, Sardinia and Crete drop out on their own once ferry
// edges are rejected. Russia is excluded because only Kaliningrad and
// St Petersburg would qualify and both distort the graph.
const COUNTRIES = new Map(Object.entries({
  PT: 'Portugal', ES: 'Spain', FR: 'France', BE: 'Belgium', NL: 'Netherlands',
  LU: 'Luxembourg', DE: 'Germany', CH: 'Switzerland', AT: 'Austria', IT: 'Italy',
  DK: 'Denmark', NO: 'Norway', SE: 'Sweden',
  FI: 'Finland', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', PL: 'Poland',
  CZ: 'Czechia', SK: 'Slovakia', HU: 'Hungary', SI: 'Slovenia', HR: 'Croatia',
  BA: 'Bosnia and Herzegovina', RS: 'Serbia', ME: 'Montenegro', MK: 'North Macedonia',
  AL: 'Albania', GR: 'Greece', BG: 'Bulgaria', RO: 'Romania', MD: 'Moldova',
  UA: 'Ukraine', BY: 'Belarus', TR: 'Turkey', XK: 'Kosovo',
}));

// Keeps Turkey to Thrace + the Aegean coast rather than dragging the graph
// across Anatolia, and drops Ukrainian/Belarusian cities far past the Dnipro.
const BBOX = { minLon: -11, maxLon: 33, minLat: 35, maxLat: 71 };

const raw = readFileSync(new URL('../data/raw/cities15000.txt', import.meta.url), 'utf8');

const candidates = [];
for (const line of raw.split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  const [geonameid, name, , , lat, lon, featClass, , country] = f;
  const population = Number(f[14]);
  if (featClass !== 'P') continue;
  if (!COUNTRIES.has(country)) continue;
  const latN = Number(lat), lonN = Number(lon);
  if (lonN < BBOX.minLon || lonN > BBOX.maxLon) continue;
  if (latN < BBOX.minLat || latN > BBOX.maxLat) continue;
  if (!population) continue;
  candidates.push({
    id: Number(geonameid), name, country, lat: latN, lon: lonN, population,
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
