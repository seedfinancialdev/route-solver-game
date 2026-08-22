// Route the career runs over the REAL road network, with alternatives.
//
// Every road is playable now, so the 2,160-edge curated graph can no longer
// answer "how far is this run" or "how many corridors does it have". This asks
// a real router over the whole OSM network instead.
//
// This is the cheap half. It uses the public OSRM demo and its own cost model,
// which is fine for measuring distance and finding corridors — but NOT for the
// game, which needs its own weights (speed by class and maxspeed, enforcement
// risk, fuel range). That needs our own routable graph; see the note at the end.
//
// Output: data/run-routes.json, web/atlas-gl/run-routes.geojson

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const HOST = process.env.OSRM_HOST || 'https://router.project-osrm.org';
const CACHE = new URL('../data/raw/osrm-runs/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

const runs = JSON.parse(readFileSync(new URL('../data/runs.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function route(id, from, to) {
  const cacheFile = new URL(`${id}.json`, CACHE);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${HOST}/route/v1/driving/${coords}`
    + '?alternatives=3&overview=simplified&geometries=geojson&steps=false';

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(3000 * 2 ** attempt);
    let res;
    try { res = await fetch(url); } catch (e) { console.log(`  net ${e.code || 'err'}`); continue; }
    if (!res.ok) { console.log(`  http ${res.status}`); continue; }
    const body = await res.json();
    if (body.code !== 'Ok') { console.log(`  osrm ${body.code}`); continue; }
    writeFileSync(cacheFile, JSON.stringify(body));
    await sleep(1500);
    return body;
  }
  return null;
}

/** Fraction of A's length that also lies on B, on a coarse grid. */
function overlap(a, b) {
  const key = ([lon, lat]) => `${lon.toFixed(1)},${lat.toFixed(1)}`;
  const setB = new Set(b.geometry.coordinates.map(key));
  const hits = a.geometry.coordinates.filter((c) => setB.has(key(c))).length;
  return hits / a.geometry.coordinates.length;
}

const out = [];
const display = { type: 'FeatureCollection', features: [] };

for (const r of runs.runs) {
  console.log(`\n${r.name}: ${r.from.name} -> ${r.to.name}`);
  const body = await route(r.id, r.from, r.to);
  if (!body) { console.log('  FAILED'); continue; }

  const routes = body.routes.map((rt, i) => ({
    index: i,
    km: Math.round(rt.distance / 1000),
    minutes: Math.round(rt.duration / 60),
    geometry: rt.geometry,
  }));

  // Distinct corridors: within tolerance of the best, and not mostly the same road.
  const best = routes[0];
  const distinct = [best];
  for (const rt of routes.slice(1)) {
    const withinTolerance = rt.minutes <= best.minutes * 1.15;
    const isDistinct = distinct.every((d) => overlap(rt, d) < 0.65);
    if (withinTolerance && isDistinct) distinct.push(rt);
  }

  for (const rt of routes) {
    console.log(`  route ${rt.index}: ${String(rt.km).padStart(5)} km  `
      + `${String(Math.floor(rt.minutes / 60)).padStart(3)}h${String(rt.minutes % 60).padStart(2, '0')}`
      + `${rt.index === 0 ? '   <- fastest' : `   +${(100 * (rt.minutes / best.minutes - 1)).toFixed(1)}%`}`);
    display.features.push({
      type: 'Feature',
      properties: { run: r.id, index: rt.index, km: rt.km, minutes: rt.minutes,
        distinct: distinct.includes(rt) },
      geometry: rt.geometry,
    });
  }

  // Section A gates that this can now answer.
  const hours = best.minutes / 60;
  console.log(`  gates: distance ${best.km >= 2500 ? 'PASS' : 'FAIL'} (${best.km} km, need 2500)`);
  console.log(`         elapsed  ${hours >= 24 && hours <= 72 ? 'PASS' : 'FAIL'} (${hours.toFixed(1)} h, need 24-72)`);
  console.log(`         corridors ${distinct.length >= 2 ? 'PASS' : 'FAIL'} (${distinct.length} distinct within +15%, need 2)`);

  out.push({ id: r.id, name: r.name, km: best.km, minutes: best.minutes,
    routesReturned: routes.length, distinctCorridors: distinct.length });
}

writeFileSync(
  new URL('../data/run-routes.json', import.meta.url),
  `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), source: 'public OSRM demo', runs: out }, null, 2)}\n`,
);
writeFileSync(new URL('../web/atlas-gl/run-routes.geojson', import.meta.url), JSON.stringify(display));

console.log('\nNote: OSRM\'s cost model is not the game\'s. These distances and');
console.log('corridors are real, but the game needs its own routable graph before');
console.log('fuel range, enforcement risk or the Google-penalty gate can be measured.');
