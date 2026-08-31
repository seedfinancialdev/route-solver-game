// The street-level layer: real OSM streets near each playable city, for the
// close-up view once a player has actually stopped somewhere — the map that
// used to show only the inter-city road network now has a real street grid
// to fall into as you zoom in on a stop, the same way the terrain layer
// falls from an overview into 195 m/px detail tiles.
//
// One query per city (radius below), real geometry, real road classes —
// never routing data, decoration only, same footing as the urban-footprint
// blobs and background towns this map already draws. Output ships as one
// small file per city (legacy/web/streets/<cityIndex>.json), fetched on
// demand the way terrain tiles already are — not bundled into
// legacy/web/data.json, since a single puzzle only ever visits 7-16 of the
// 479 cities. Feeds the legacy shipped game; see legacy/README.md.
//
// Run: node scripts/07-streets.mjs
// Rebuild a subset only: node scripts/07-streets.mjs --only=Bergen,Prague

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { project } from './lib/proj.mjs';
import { simplify } from './lib/simplify.mjs';
import { streetsForCities } from './lib/overpass.mjs';

const RADIUS_M = Number(process.env.STREET_RADIUS_M || 900);
const SIMPLIFY_KM = 0.02; // tighter than the inter-city roads (0.12) — this is close-up geometry
const QUANT = 40; // 25 m grid

const graph = JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8'));
const OUT_DIR = new URL('../legacy/web/streets/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const cities = graph.cities.filter((c) => !only || only.has(c.name));

// motorway/trunk/primary read as the wide, heavy roads a driver actually
// navigates by; secondary/tertiary as the ordinary street grid; the rest as
// the fine residential texture that makes a stop look like a real place
// rather than three arterial lines on empty ground. Same three-tier visual
// language as the pace-tier lines already use, but here it's about a road's
// real class/width, not its measured speed — different fact, same weight
// vocabulary a player already reads.
const TIER = { motorway: 2, trunk: 2, primary: 2, secondary: 1, tertiary: 1, unclassified: 0, residential: 0, living_street: 0, road: 0 };
const tierOf = (hw) => TIER[(hw || '').replace(/_link$/, '')] ?? 0;

const jobs = cities.map((c) => ({ city: c, key: String(c.geonameid) }));
console.log(`fetching streets for ${jobs.length} cities (${RADIUS_M}m radius)...`);
const t0 = Date.now();
const results = await streetsForCities(jobs, RADIUS_M, (done, total, failed) => {
  if (done % 20 === 0 || done === total) {
    console.log(`  ${done}/${total} (${failed} failed so far), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
});

let written = 0, failed = 0, totalBytes = 0;
// Load any existing manifest first — a --only rerun (retrying a handful of
// previously-failed cities, say) must add to it, not replace it. Caught this
// the hard way: a first version overwrote a 461-city manifest down to the 15
// entries a --only=... retry actually touched, silently orphaning 446 real,
// already-fetched per-city files that were still sitting on disk untouched.
let manifest = {};
const manifestFile = new URL('manifest.json', OUT_DIR);
if (existsSync(manifestFile)) manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
cities.forEach((city, i) => {
  const ways = results[i];
  if (ways === null) { failed++; return; }

  const cx = project(city.lon, city.lat);
  const runs = [];
  for (const way of ways) {
    const projected = way.geometry.map((pt) => {
      const p = project(pt.lon, pt.lat);
      return [Math.round((p.x - cx.x) * QUANT), Math.round((p.y - cx.y) * QUANT)];
    });
    const shape = simplify(projected, SIMPLIFY_KM * QUANT);
    if (shape.length < 2) continue;
    const flat = [];
    let px = 0, py = 0;
    for (const [x, y] of shape) { flat.push(x - px, y - py); px = x; py = y; }
    runs.push([tierOf(way.tags.highway), ...flat]);
  }
  if (!runs.length) { failed++; return; }

  const out = { quant: QUANT, cx: Math.round(cx.x * 100) / 100, cy: Math.round(cx.y * 100) / 100, runs };
  const json = JSON.stringify(out);
  writeFileSync(new URL(`${city.geonameid}.json`, OUT_DIR), json);
  totalBytes += json.length;
  written++;
  manifest[city.i] = city.geonameid;
});

writeFileSync(new URL('manifest.json', OUT_DIR), JSON.stringify(manifest));

console.log(`\n${written} cities written (${(totalBytes / 1024).toFixed(0)} KB total, `
  + `${(totalBytes / written / 1024).toFixed(1)} KB/city avg), ${failed} with no usable data`);
console.log(`${((Date.now() - t0) / 1000 / 60).toFixed(1)} minutes total`);
