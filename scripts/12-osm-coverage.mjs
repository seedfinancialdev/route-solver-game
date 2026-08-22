// Phase 6: what does OSM actually carry, per country, along the roads this
// game is played on?
//
// The rule this serves: the game only models what it can import and refresh.
// Coverage is not uniform — maxspeed tagging is excellent in some countries and
// thin in others — and a promise of "real speed limits" that silently degrades
// is worse than no promise, because a player's real-world knowledge stops
// working exactly where the map still looks inviting. So measure first, and let
// coverage decide what goes in scope.
//
// Method: SAMPLE, don't enumerate. An earlier version counted every major way
// inside each country's bounding box; correct, but ~5 minutes per query against
// a shared public service, and it measures ground the game never drives. This
// samples points along the actual routed edges and asks a small question at
// each one — faster, kinder, and a truer measure of the roads that matter.
//
// Cached per sample under data/raw/overpass-coverage/, so a re-run is free and
// an interrupted run resumes.
//
// Output: data/osm-coverage.json
// Usage: node scripts/12-osm-coverage.mjs [--limit N] [--samples N] [--only DE,RS]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ENDPOINT = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const THROTTLE_MS = Number(process.env.OVERPASS_THROTTLE_MS || 1200);
const CACHE = new URL('../data/raw/overpass-coverage/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const argVal = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const LIMIT = Number(argVal('--limit') || 22);
const SAMPLES = Number(argVal('--samples') || 10);
const ONLY = (argVal('--only') || '').split(',').filter(Boolean);

const graph = JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8'));

// Sample points taken FROM the real edge geometries, so every probe lands on a
// road the game actually routes over.
const byCountry = new Map();
for (const e of graph.edges) {
  const a = graph.cities[e.a], b = graph.cities[e.b];
  if (!a || !b || a.country !== b.country) continue;   // skip cross-border edges
  const list = byCountry.get(a.country) || [];
  const g = e.geometry;
  if (g && g.length > 2) list.push(g[Math.floor(g.length / 2)]);
  byCountry.set(a.country, list);
}

const cityCount = new Map();
for (const c of graph.cities) cityCount.set(c.country, (cityCount.get(c.country) || 0) + 1);

let countries = [...byCountry.entries()]
  .filter(([, pts]) => pts.length > 0)
  .map(([iso, pts]) => {
    // spread the samples across the country rather than taking the first N
    const stride = Math.max(1, Math.floor(pts.length / SAMPLES));
    const picked = [];
    for (let i = 0; i < pts.length && picked.length < SAMPLES; i += stride) picked.push(pts[i]);
    return { iso, cities: cityCount.get(iso) || 0, points: picked };
  })
  .sort((a, b) => b.cities - a.cities);

countries = ONLY.length ? countries.filter((c) => ONLY.includes(c.iso)) : countries.slice(0, LIMIT);

const MAJOR = new Set(['motorway', 'trunk', 'primary']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything we want to know about one ~9km box, in a single small query. */
async function probe(iso, index, [lon, lat]) {
  const cacheFile = new URL(`${iso}-${index}.json`, CACHE);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const dLat = 0.04;
  const dLon = 0.04 / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(4)).join(',');
  const query = `[out:json][timeout:60][bbox:${bbox}];
(
  way["highway"~"^(motorway|trunk|primary)$"];
  nwr["amenity"="fuel"];
  nwr["highway"="services"];
  nwr["barrier"="border_control"];
);
out tags;`;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(THROTTLE_MS * 2 ** attempt);
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'route-solver-game coverage probe (sampled, tags only)' },
        body: new URLSearchParams({ data: query }),
      });
    } catch (err) { process.stdout.write(`[net:${err.code || 'err'}]`); continue; }
    if (!res.ok) { process.stdout.write(`[${res.status}]`); continue; }

    const body = await res.json();
    const tally = { major: 0, maxspeed: 0, toll: 0, fuel: 0, services: 0, border: 0 };
    for (const el of body.elements || []) {
      const t = el.tags || {};
      if (el.type === 'way' && MAJOR.has(t.highway)) {
        tally.major++;
        if (t.maxspeed) tally.maxspeed++;
        if (t.toll === 'yes') tally.toll++;
      }
      if (t.amenity === 'fuel') tally.fuel++;
      if (t.highway === 'services') tally.services++;
      if (t.barrier === 'border_control') tally.border++;
    }
    writeFileSync(cacheFile, JSON.stringify(tally));
    await sleep(THROTTLE_MS);
    return tally;
  }
  return null;
}

const out = {};
for (const c of countries) {
  process.stdout.write(`${c.iso.padEnd(3)} `);
  const sum = { major: 0, maxspeed: 0, toll: 0, fuel: 0, services: 0, border: 0 };
  let ok = 0;
  for (let i = 0; i < c.points.length; i++) {
    const t = await probe(c.iso, i, c.points[i]);
    if (t) { ok++; for (const k of Object.keys(sum)) sum[k] += t[k]; process.stdout.write('.'); }
    else process.stdout.write('x');
  }
  const pct = sum.major > 0 ? Math.round((1000 * sum.maxspeed) / sum.major) / 10 : null;
  out[c.iso] = { cities: c.cities, samples: ok, ...sum, maxspeedPct: pct };
  process.stdout.write(`  maxspeed ${pct ?? '?'}%  fuel ${sum.fuel}\n`);
}

writeFileSync(
  new URL('../data/osm-coverage.json', import.meta.url),
  `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap via Overpass',
    method: `${SAMPLES} sampled ~9km boxes per country, centred on real routed edge geometry`,
    caveat: 'Counts are per sample, not national totals. Compare countries, not absolutes.',
    countries: out,
  }, null, 2)}\n`,
);

// ---- report ---------------------------------------------------------------
const rows = Object.entries(out).sort((a, b) => (b[1].maxspeedPct ?? -1) - (a[1].maxspeedPct ?? -1));
const p = (v, n) => String(v ?? '?').padStart(n);
console.log(`\n${'iso'.padEnd(4)}${p('major', 7)}${p('maxspd', 8)}${p('%', 7)}${p('toll', 6)}${p('fuel', 6)}${p('svc', 5)}${p('border', 7)}`);
for (const [iso, r] of rows) {
  console.log(`${iso.padEnd(4)}${p(r.major, 7)}${p(r.maxspeed, 8)}${p(r.maxspeedPct, 7)}${p(r.toll, 6)}${p(r.fuel, 6)}${p(r.services, 5)}${p(r.border, 7)}`);
}
const known = rows.filter(([, r]) => r.maxspeedPct != null).map(([, r]) => r.maxspeedPct).sort((a, b) => a - b);
if (known.length) {
  console.log(`\nmaxspeed coverage — best ${known[known.length - 1]}%  median ${known[Math.floor(known.length / 2)]}%  worst ${known[0]}%`);
  const thin = rows.filter(([, r]) => r.maxspeedPct != null && r.maxspeedPct < 50).map(([iso]) => iso);
  console.log(thin.length
    ? `under 50% — a real-limits promise degrades here: ${thin.join(', ')}`
    : 'every sampled country is above 50%.');
}
