// One file for the browser.
//
// Cities and road geometry arrive with projected coordinates already baked in,
// so the page never needs the projection code — it draws the numbers as given.
// The graph ships whole because the game finds the fastest route itself at
// reveal time; that keeps the payload small and lets practice mode play any pair.
//
// Output: legacy/web/data.json — the legacy shipped game's bundle. See
// legacy/README.md: this pipeline stage is retired along with the game it fed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { project } from './lib/proj.mjs';
import { COUNTRIES } from './lib/cities.mjs';
import { COUNTRY_SPEED } from './lib/country-facts.mjs';
import { simplify } from './lib/simplify.mjs';

const SIMPLIFY_KM = 0.12;  // Douglas-Peucker tolerance. The map zooms to 90 km
                           // across, where a tenth of a kilometre is about a
                           // pixel and a half.
const QUANT = 20;          // 50 m grid for the encoded shapes

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const graph = read('graph.json');
const map = read('map.json');
const pack = read('puzzles.json');
// Optional: real road names/refs (scripts/06-road-names.mjs), for narration
// only. Missing this file just means hop narration falls back to a generic
// line — it was never part of the routing data.
let roadNames = null;
try { roadNames = read('road-names.json'); } catch { /* not built yet */ }

const round = (v) => Math.round(v * 2) / 2;

const cities = graph.cities.map((c) => {
  const p = project(c.lon, c.lat);
  return [c.name, c.country, round(p.x), round(p.y)];
});

// How fast each stretch of road runs, in three tiers — the same three the hop
// glyphs use. This is the information the player was missing: standing in
// Rzeszów you can now see that the road south is a slow mountain two-lane and
// the road north is a main road, without being told what either will cost.
const FAST_KMH = 85;
const ORDINARY_KMH = 65;
const tierOf = (kmh) => (kmh >= FAST_KMH ? 2 : kmh >= ORDINARY_KMH ? 1 : 0);

/**
 * OSRM's steps run in order along the route, so their cumulative distances
 * divide it into stretches. Walk the drawn shape, keeping a running distance,
 * and label each point with the stretch it falls in.
 */
function tiersAlong(shape, steps, roadKm) {
  if (!steps || !steps.length) return '1'.repeat(shape.length);
  const bounds = [];
  let acc = 0;
  for (const [metres, seconds] of steps) {
    acc += metres;
    bounds.push({ upTo: acc, tier: tierOf(seconds > 0 ? (metres / 1000) / (seconds / 3600) : 0) });
  }
  const totalStepM = acc || 1;

  // The drawn shape is simplified and projected, so its length is close to but
  // not exactly the routed distance. Scale one onto the other.
  let shapeLen = 0;
  for (let i = 1; i < shape.length; i++) {
    shapeLen += Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]);
  }
  const scale = shapeLen > 0 ? totalStepM / shapeLen : 1;

  let travelled = 0, cursor = 0;
  const out = [];
  for (let i = 0; i < shape.length; i++) {
    if (i > 0) travelled += Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]) * scale;
    while (cursor < bounds.length - 1 && travelled > bounds[cursor].upTo) cursor++;
    out.push(bounds[cursor].tier);
  }
  void roadKm;
  return out.join('');
}

// [a, b, km, minutes, tiers, x0, y0, dx1, dy1, ...] — the road's shape,
// delta-encoded on a quarter-kilometre grid. Absolute coordinates cost six or
// seven characters each and the steps between them cost two, which is worth
// the decoder.
const edges = graph.edges.map((e) => {
  const projected = (e.geometry || []).map(([lon, lat]) => {
    const p = project(lon, lat);
    return [Math.round(p.x * QUANT), Math.round(p.y * QUANT)];
  });
  const shape = simplify(projected, SIMPLIFY_KM * QUANT);
  const tiers = tiersAlong(shape, e.steps, e.km);
  const flat = [];
  let px = 0, py = 0;
  for (const [x, y] of shape) { flat.push(x - px, y - py); px = x; py = y; }
  return [e.a, e.b, e.km, e.min, tiers, ...flat];
});

const bundle = {
  generated: graph.generated,
  // The decoder reads this rather than hardcoding it: the two drifted apart
  // once already and every road silently landed in the wrong place.
  quant: QUANT,
  view: map.view,
  // ISO2 -> full name, for showing a city's country in the brief. Sourced
  // from the same map scripts/00-cities.mjs used to pick the roster, so it
  // can't drift from the country list the game actually uses.
  countryNames: Object.fromEntries(COUNTRIES),
  // ISO2 -> {motorway, rural, urban, note?} legal speed limits in km/h, real
  // and sourced (scripts/lib/country-facts.mjs) — the reason a country's
  // measured network pace runs faster or slower than average is often just
  // this. motorway: null means no motorway network exists (Moldova).
  countrySpeed: COUNTRY_SPEED,
  countries: map.countries.map((c) => c.d),
  // [name, x, y]
  countryLabels: map.labels.map((l) => [l.name, l.x, l.y]),
  lakes: map.lakes,
  rivers: map.rivers,
  urbanAreas: map.urbanAreas,
  // [name, x, y, kind, lengthKm, peakName, peakM, blurb, pacePct] — kind is
  // "relief" (a range, plateau, plain) or "sea". The relief-only fields are
  // null for sea. lengthKm/peakName/peakM are null unless the range is one
  // of the hand-curated RANGE_FACTS entries in 03-map.mjs (real reference
  // figures, not derived from this dataset's own — deliberately inaccurate
  // for this purpose — polygon geometry). blurb is the generic landform-type
  // explainer, set for every relief feature. pacePct is real and computed —
  // the distance-weighted average speed of graph edges near this region
  // against the network-wide average — null where fewer than 4 edges pass
  // near enough to mean anything.
  physicalLabels: (map.physicalLabels || []).map((l) => [
    l.name, l.x, l.y, l.kind, l.lengthKm ?? null, l.peakName ?? null, l.peakM ?? null, l.blurb ?? null,
    l.pacePct ?? null,
  ]),
  // [x, y, tier] — background towns below the playable roster's spacing cut.
  // Decoration only: they connect to nothing and cost nothing to draw wrong.
  towns: (map.towns || []).map((t) => [t.x, t.y, t.tier]),
  graticule: map.graticule || [],
  // [label, km, sharePercent] aligned index-for-index with `edges` above, or
  // null where OSRM had no ref and no name for the road's longest stretch.
  // Decoration for narration — the game's routing never reads this.
  roadNames: graph.edges.map((e, i) => {
    // road-names.json was built by walking these same edges in this same
    // order (06-road-names.mjs), so index i lines up directly — no need to
    // re-match by (a, b).
    const r = roadNames && roadNames.roads[i];
    if (!r || r.a !== e.a || r.b !== e.b || !r.dominant) return null;
    return [r.dominant.label, r.dominant.km, Math.round(r.dominant.share * 100)];
  }),
  cities,
  edges,
  currency: pack.currency,
  budgetMultiplier: pack.budgetMultiplier,
  // [a, b, budgetMin, optimalMin, shortestMin]
  puzzles: pack.puzzles.map((p) => [p.a, p.b, p.budgetMin, p.optimalMin, p.shortestMin]),
};

mkdirSync(new URL('../legacy/web/', import.meta.url), { recursive: true });
const out = new URL('../legacy/web/data.json', import.meta.url);
writeFileSync(out, JSON.stringify(bundle));

const pts = edges.map((e) => (e.length - 5) / 2);
const tierMix = { 0: 0, 1: 0, 2: 0 };
for (const e of edges) for (const c of e[4]) tierMix[c]++;
console.log(`  road stretches by pace — slow ${tierMix[0]}, ordinary ${tierMix[1]}, motorway ${tierMix[2]}`);
console.log(`legacy/web/data.json — ${(readFileSync(out).length / 1024).toFixed(0)} KB`);
console.log(`  ${cities.length} cities, ${edges.length} roads, ${bundle.puzzles.length} puzzles`);
console.log(`  road shape points per hop: min ${Math.min(...pts)}, median `
  + `${pts.slice().sort((a, b) => a - b)[pts.length >> 1]}, max ${Math.max(...pts)}`);
