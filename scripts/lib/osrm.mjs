// Thin client for an OSRM server, with an on-disk cache.
//
// This runs exactly once, at build time. The shipped game makes no routing
// calls — everything ends up in data/graph.json.
//
// We ask for `steps=true` and keep only a summary. The reason is the ferry
// flag: OSRM marks ferry legs with mode "ferry", which is the one reliable way
// to tell the Messina crossing (a ferry, 6.5 km of it) from the Øresund
// crossing (a bridge, and a genuine road). Without it, sea hops leak into the
// graph and the player is asked to estimate a cost no map could show them.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const HOST = process.env.OSRM_HOST || 'https://router.project-osrm.org';
const CACHE_DIR = new URL('../../data/raw/osrm-cache/', import.meta.url);
const THROTTLE_MS = Number(process.env.OSRM_THROTTLE_MS || 120);
const CONCURRENCY = Number(process.env.OSRM_CONCURRENCY || 3);

mkdirSync(CACHE_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {{km:number, min:number, ferryKm:number}|null} null = no route at all */
async function routePair(a, b, cacheKey) {
  const cacheFile = new URL(`${cacheKey}.json`, CACHE_DIR);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  // `overview=full` rather than `simplified`: the simplified overview leaves
  // kilometres between vertices, which is invisible at continental scale and
  // a polygon the moment anyone zooms. The shape is thinned to something
  // sensible in 01-graph.mjs once it has been projected.
  const url = `${HOST}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}`
    + '?overview=full&geometries=geojson&steps=true&alternatives=false';

  let out;
  for (let attempt = 0; attempt < 5 && out === undefined; attempt++) {
    await sleep(THROTTLE_MS * (attempt + 1) ** 2);
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) continue;
      const json = await res.json();
      if (json.code === 'NoRoute') { out = null; break; }
      if (json.code !== 'Ok') continue;
      const route = json.routes[0];
      let ferryM = 0;
      // Per-step distance and duration is how the game knows where a road runs
      // fast and where it crawls. A step is a stretch between manoeuvres, so it
      // resolves to a few kilometres — enough to see a motorway give way to a
      // mountain road partway through a hop.
      const steps = [];
      for (const leg of route.legs) {
        for (const step of leg.steps) {
          if (step.mode === 'ferry') ferryM += step.distance;
          steps.push([Math.round(step.distance), Math.round(step.duration)]);
        }
      }
      out = {
        km: Math.round(route.distance / 100) / 10,
        min: Math.round(route.duration / 6) / 10,
        ferryKm: Math.round(ferryM / 100) / 10,
        geometry: (route.geometry?.coordinates || []).map(
          ([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]),
        steps,
      };
    } catch { /* network hiccup, retry */ }
  }
  if (out === undefined) throw new Error(`OSRM failed for ${cacheKey}`);

  writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

/** Measures many pairs with a small worker pool. onProgress(done, total). */
export async function measurePairs(jobs, onProgress = () => {}) {
  const results = new Array(jobs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const idx = next++;
      const { a, b, key } = jobs[idx];
      results[idx] = await routePair(a, b, key);
      onProgress(++done, jobs.length);
    }
  }));
  return results;
}
