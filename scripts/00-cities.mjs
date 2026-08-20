// Phase 0, step 1: pick the city set from GeoNames cities15000 + Iconic Rally Landmarks.
//
// Input:  data/raw/cities15000.txt (GeoNames tab-separated dump)
// Output: data/cities.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { haversineKm } from './lib/geo.mjs';
import { inGameEurope, parseRow } from './lib/cities.mjs';

const TARGET_COUNT = 850;
const MIN_SPACING_KM = 45;

// Legendary motorsport capitals, microstates, and alpine rally hubs that are unconditionally included
const ICONIC_LANDMARKS = [
  { name: 'Monaco', country: 'MC', lat: 43.7372, lon: 7.4214, population: 38000, id: 2993458 },
  { name: 'Andorra la Vella', country: 'AD', lat: 42.5078, lon: 1.5211, population: 22000, id: 3041563 },
  { name: 'San Marino', country: 'SM', lat: 43.9367, lon: 12.4464, population: 4500, id: 3168070 },
  { name: 'Vaduz', country: 'LI', lat: 47.1415, lon: 9.5215, population: 5400, id: 3042030 },
  { name: 'Gibraltar', country: 'GI', lat: 36.1408, lon: -5.3536, population: 34000, id: 2411585 },
  { name: 'Spa', country: 'BE', lat: 50.4908, lon: 5.8644, population: 10500, id: 2786318 },
  { name: 'Nürburg', country: 'DE', lat: 50.3428, lon: 6.9511, population: 2000, id: 2862047 },
  { name: 'Maranello', country: 'IT', lat: 44.5262, lon: 10.8669, population: 17500, id: 3174246 },
  { name: 'Chamonix-Mont-Blanc', country: 'FR', lat: 45.9237, lon: 6.8694, population: 8900, id: 3027301 },
  { name: 'St. Moritz', country: 'CH', lat: 46.4908, lon: 9.8355, population: 5200, id: 2658822 },
  { name: 'Cortina d\'Ampezzo', country: 'IT', lat: 46.5405, lon: 12.1357, population: 5800, id: 3178229 },
  { name: 'Davos', country: 'CH', lat: 46.8043, lon: 9.8372, population: 11000, id: 2661039 },
  { name: 'Interlaken', country: 'CH', lat: 46.6863, lon: 7.8632, population: 5700, id: 2660253 },
  { name: 'Kitzbühel', country: 'AT', lat: 47.4464, lon: 12.3922, population: 8200, id: 2774351 },
];

const rawPath = new URL('../data/raw/cities15000.txt', import.meta.url);
if (!existsSync(rawPath)) {
  console.error('Error: data/raw/cities15000.txt not found.');
  process.exit(1);
}

const raw = readFileSync(rawPath, 'utf8');

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

// 1. Seed with Iconic Landmarks first
const picked = [...ICONIC_LANDMARKS];

// 2. Fill with standard population-weighted European cities
for (const c of candidates) {
  if (picked.length >= TARGET_COUNT + ICONIC_LANDMARKS.length) break;
  // If city is an iconic landmark, skip duplication
  if (picked.some(p => p.id === c.id || p.name.toLowerCase() === c.name.toLowerCase())) continue;
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
console.log(`${cities.length} cities (including ${ICONIC_LANDMARKS.length} iconic landmarks), spacing >= ${MIN_SPACING_KM} km`);
console.log(Object.entries(byCountry).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log(`Included iconic checkpoints: ${ICONIC_LANDMARKS.map(l => l.name).join(', ')}`);
