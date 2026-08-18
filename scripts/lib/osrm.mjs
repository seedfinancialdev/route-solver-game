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
const NAMES_CACHE_DIR = new URL('../../data/raw/osrm-names-cache/', import.meta.url);
const THROTTLE_MS = Number(process.env.OSRM_THROTTLE_MS || 120);
const CONCURRENCY = Number(process.env.OSRM_CONCURRENCY || 3);

mkdirSync(CACHE_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The raw OSRM response for one pair, retried the same way every caller in
 * this file needs. Returns the full route object (legs and all) so a caller
 * can pull out whatever the reduced `routePair` shape below doesn't keep —
 * `routePair` throws away step names/refs because the game never needed them
 * until now; a second caller that does want them re-fetches through here
 * rather than that shape growing fields most call sites don't use.
 *
 * @returns {object|null} the OSRM `route` object, or null for "no route at all"
 */
async function fetchRoute(a, b) {
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
      out = json.routes[0];
    } catch { /* network hiccup, retry */ }
  }
  if (out === undefined) throw new Error(`OSRM failed for ${a.lon},${a.lat} -> ${b.lon},${b.lat}`);
  return out;
}

/** @returns {{km:number, min:number, ferryKm:number}|null} null = no route at all */
async function routePair(a, b, cacheKey) {
  const cacheFile = new URL(`${cacheKey}.json`, CACHE_DIR);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const route = await fetchRoute(a, b);
  let out = null;
  if (route) {
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
  }

  writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

/**
 * Same route, but the names and refs OSRM already returns and `routePair`
 * throws away — kept as a separate cache and a separate call so the existing
 * routing cache's shape (and everything built from it) never changes.
 * @returns {{label:string, km:number}[]|null} consecutive steps sharing a
 *   name/ref merged into runs — a road usually breaks into several OSRM
 *   "steps" at every intersection despite being the one named road throughout.
 */
async function namedRunsPair(a, b, cacheKey) {
  const cacheFile = new URL(`${cacheKey}.json`, NAMES_CACHE_DIR);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const route = await fetchRoute(a, b);
  let runs = null;
  if (route) {
    runs = [];
    for (const leg of route.legs) {
      for (const step of leg.steps) {
        if (step.mode === 'ferry' || step.distance <= 0) continue;
        // The route number (ref) is language-independent — "A1" reads the same
        // in Bulgaria as in Belgium. The name is whatever OSM's local tag says,
        // which is the local language; that's kept only as a fallback.
        // A quarter of all refs come back "A 1" rather than "A1" — a genuine
        // tagging-convention split between countries' OSM data, not an error —
        // but it reads like a typo once it's sitting in a sentence, so the
        // space between a short letter prefix and its number is collapsed.
        // The road's own name (no ref) is left alone: that's prose, not a code.
        const label = (step.ref && step.ref.replace(/^([A-Za-z]{1,3})\s+(\d)/, '$1$2')) || step.name || null;
        const km = step.distance / 1000;
        const last = runs[runs.length - 1];
        if (last && last.label === label) last.km += km;
        else runs.push({ label, km });
      }
    }
  }

  mkdirSync(NAMES_CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(runs));
  return runs;
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

/** Same worker pool, for the name/ref runs along many pairs. */
export async function namedRunsForPairs(jobs, onProgress = () => {}) {
  const results = new Array(jobs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const idx = next++;
      const { a, b, key } = jobs[idx];
      results[idx] = await namedRunsPair(a, b, key);
      onProgress(++done, jobs.length);
    }
  }));
  return results;
}
