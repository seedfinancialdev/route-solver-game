// Thin client for OpenStreetMap street data via the Overpass API, with an
// on-disk cache — same shape as scripts/lib/osrm.mjs, for the same reason:
// this runs once at build time, and the shipped game makes no map-data
// calls of its own.
//
// Unlike OSRM (one public demo server, generally reliable for this project's
// call volume), the public Overpass mirrors are individually flaky under any
// real load — measured directly: 3 of 4 back-to-back queries against the
// mail.ru mirror timed out. So this rotates across several public mirrors
// rather than trusting one, and caches each city's result to disk as soon as
// it succeeds so a killed/resumed run never re-fetches a city that already
// worked. A city that fails against every mirror, every retry, just gets no
// street data — same graceful-fallback shape as road-names.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const MIRRORS = (process.env.OVERPASS_MIRRORS || [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
].join(',')).split(',').filter(Boolean);

const CACHE_DIR = new URL('../../data/raw/overpass-cache/', import.meta.url);
const THROTTLE_MS = Number(process.env.OVERPASS_THROTTLE_MS || 400);
const CONCURRENCY = Number(process.env.OVERPASS_CONCURRENCY || 2);
const TIMEOUT_MS = Number(process.env.OVERPASS_TIMEOUT_MS || 25000);

mkdirSync(CACHE_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Streets within `radiusM` of (lat, lon), real ways with real geometry.
 * Retries each mirror once before moving to the next, then cycles the whole
 * mirror list up to 2 times — a genuinely dead city gets ~10 attempts spread
 * across 5 different servers before giving up, not 5 retries hammering one.
 * @returns {Array<{tags: object, geometry: Array<{lat,lon}>}>|null} null =
 *   every mirror failed (network/timeout), not "OSM has no streets here."
 */
async function fetchStreets(lat, lon, radiusM) {
  const query = `[out:json][timeout:25];`
    + `way["highway"]["highway"!~"^(footway|path|steps|cycleway|track|service|pedestrian|proposed|construction)$"]`
    + `(around:${radiusM},${lat},${lon});out geom;`;

  for (let cycle = 0; cycle < 2; cycle++) {
    for (const mirror of MIRRORS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch(mirror, {
          method: 'POST', body: query, signal: controller.signal,
          headers: { 'Content-Type': 'text/plain' },
        });
        clearTimeout(timer);
        if (!res.ok) continue;
        const json = await res.json();
        if (!Array.isArray(json.elements)) continue;
        return json.elements
          .filter((e) => e.type === 'way' && e.geometry && e.geometry.length >= 2)
          .map((e) => ({ tags: e.tags || {}, geometry: e.geometry }));
      } catch { /* network hiccup or timeout — try the next mirror */ }
      await sleep(THROTTLE_MS);
    }
  }
  return null;
}

/** @returns {Array|null} cached or freshly-fetched ways; null = every mirror failed */
async function streetsForCity(city, radiusM, cacheKey) {
  const cacheFile = new URL(`${cacheKey}.json`, CACHE_DIR);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const ways = await fetchStreets(city.lat, city.lon, radiusM);
  if (ways === null) return null; // don't cache a network failure as "no streets"
  writeFileSync(cacheFile, JSON.stringify(ways));
  return ways;
}

/** Fetches many cities' streets with a small worker pool. onProgress(done, total, failed). */
export async function streetsForCities(jobs, radiusM, onProgress = () => {}) {
  const results = new Array(jobs.length);
  let next = 0, done = 0, failed = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const idx = next++;
      const { city, key } = jobs[idx];
      const ways = await streetsForCity(city, radiusM, key);
      if (ways === null) failed++;
      results[idx] = ways;
      onProgress(++done, jobs.length, failed);
    }
  }));
  return results;
}
