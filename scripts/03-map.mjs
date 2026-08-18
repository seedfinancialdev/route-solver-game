// Phase 4, step 1: Natural Earth boundaries -> SVG paths.
//
// No tiles, no map library, no key. Country outlines and nothing else: roads
// follow valleys and avoid mountains, so a visible road network would hand the
// player the answer before they commit.
//
// Uses the same conic projection as the adjacency graph, so "looks nearby" and
// "is a neighbour" agree.
//
// Output: data/map.json (merged into the browser bundle by 05-bundle.mjs)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { project } from './lib/proj.mjs';

const PAD_KM = 260;          // breathing room around the outermost city
const QUANT = 2;             // round coordinates to 1/2 km; below that is noise

// The clip window is a few degrees wider than the projected view on every side,
// so mapshaper's straight clip edges fall outside the frame instead of drawing
// a false coastline across the corner of the map. Islands below 1200 km2 go:
// at this simplification they survive as triangles, which read as artefacts.
const SOURCE = new URL('../data/raw/ne_50m_admin_0_countries.geojson', import.meta.url);
const CLIPPED = new URL('../data/raw/europe.geojson', import.meta.url);
const CLIP_BOX = 'bbox=-33,25,55,68';
if (!existsSync(CLIPPED) || process.env.REBUILD_BOUNDARIES) {
  execFileSync('npx', ['mapshaper', SOURCE.pathname,
    '-clip', CLIP_BOX,
    '-filter-islands', 'min-area=1200km2', 'remove-empty',
    '-simplify', '40%', 'keep-shapes',
    // LABEL_X/LABEL_Y are Natural Earth's own placements for a country's name,
    // which beat a centroid for awkward shapes like Norway or Croatia.
    '-filter-fields', 'ISO_A2,NAME,LABEL_X,LABEL_Y,LABELRANK',
    '-o', 'format=geojson', 'precision=0.001', CLIPPED.pathname,
  ], { stdio: 'inherit' });
}

// Water. Half the detours on this map are a road going round a lake or waiting
// for a bridge, and without it the player is asked to explain a bend they cannot
// see the reason for.
function prepareWater(name, args) {
  const src = new URL(`../data/raw/${name}.geojson`, import.meta.url);
  const out = new URL(`../data/raw/${name}.clipped.geojson`, import.meta.url);
  if (!existsSync(out) || process.env.REBUILD_BOUNDARIES) {
    execFileSync('npx', ['mapshaper', src.pathname, '-clip', CLIP_BOX, ...args,
      '-o', 'format=geojson', 'precision=0.001', out.pathname], { stdio: 'inherit' });
  }
  return JSON.parse(readFileSync(out, 'utf8'));
}

const geo = JSON.parse(readFileSync(CLIPPED, 'utf8'));
// scalerank filters to the waters worth drawing: the Danube and the Rhine, not
// every tributary in the Massif Central.
const lakesGeo = prepareWater('ne_10m_lakes',
  ['-filter', 'scalerank <= 4', '-simplify', '20%', 'keep-shapes', '-filter-fields', 'name']);
const riversGeo = prepareWater('ne_10m_rivers_lake_centerlines',
  ['-filter', 'scalerank <= 5', '-simplify', '25%', 'keep-shapes', '-filter-fields', 'name']);
const graph = JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8'));

// --- view window ------------------------------------------------------------
// Framed on the cities, not on the continent: empty ocean is wasted screen.
const projected = graph.cities.map((c) => project(c.lon, c.lat));
const view = {
  x: Math.min(...projected.map((p) => p.x)) - PAD_KM,
  y: Math.min(...projected.map((p) => p.y)) - PAD_KM,
};
view.w = Math.max(...projected.map((p) => p.x)) + PAD_KM - view.x;
view.h = Math.max(...projected.map((p) => p.y)) + PAD_KM - view.y;

// --- paths ------------------------------------------------------------------
const round = (v) => Math.round(v * QUANT) / QUANT;

function ringToPath(ring) {
  let d = '';
  let px = null, py = null;
  for (const [lon, lat] of ring) {
    const p = project(lon, lat);
    const x = round(p.x), y = round(p.y);
    if (x === px && y === py) continue;
    d += d === '' ? `M${x} ${y}` : `L${x} ${y}`;
    px = x; py = y;
  }
  return d === '' ? '' : `${d}Z`;
}

function lineToPath(line) {
  let d = '', px = null, py = null;
  for (const [lon, lat] of line) {
    const p = project(lon, lat);
    const x = round(p.x), y = round(p.y);
    if (x === px && y === py) continue;
    d += d === '' ? `M${x} ${y}` : `L${x} ${y}`;
    px = x; py = y;
  }
  return d;
}

function shapePath(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.map((poly) => poly.map(ringToPath).join('')).join('');
}

// Anything entirely outside the frame is dead weight in the payload.
const inFrame = (geometry) => {
  if (!geometry) return false;   // mapshaper's clip leaves empty features behind
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates.map((p) => p[0])
      : geometry.type === 'LineString' ? [geometry.coordinates]
        : geometry.coordinates;
  for (const poly of [rings]) {
    for (const ring of poly) for (const [lon, lat] of ring) {
      const p2 = project(lon, lat);
      if (p2.x > view.x - 400 && p2.x < view.x + view.w + 400
        && p2.y > view.y - 400 && p2.y < view.y + view.h + 400) return true;
    }
  }
  return false;
};

const countries = geo.features
  .filter((f) => inFrame(f.geometry))
  .map((f) => ({
    iso: f.properties.ISO_A2,
    name: f.properties.NAME,
    d: shapePath(f.geometry),
  }))
  .filter((c) => c.d.length > 0);

// Country names, as quiet background typography: knowing you are about to cross
// into Germany rather than Albania is exactly the kind of thing that tells you
// what the road will be like.
const labels = geo.features
  .filter((f) => inFrame(f.geometry) && f.properties.LABEL_X != null)
  .map((f) => {
    const p = project(Number(f.properties.LABEL_X), Number(f.properties.LABEL_Y));
    return { name: f.properties.NAME, x: round(p.x), y: round(p.y), rank: f.properties.LABELRANK ?? 5 };
  })
  // Rank 6 is the microstates — Liechtenstein, San Marino, Andorra, the Vatican.
  // Their names are longer than their territory and they only add noise.
  .filter((l) => l.rank <= 5)
  .filter((l) => l.x > view.x && l.x < view.x + view.w && l.y > view.y && l.y < view.y + view.h);

const lakes = lakesGeo.features
  .filter((f) => inFrame(f.geometry))
  .map((f) => shapePath(f.geometry))
  .filter(Boolean);

const rivers = riversGeo.features
  .filter((f) => inFrame(f.geometry))
  .map((f) => {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return lines.map(lineToPath).filter(Boolean).join('');
  })
  .filter(Boolean);

writeFileSync(
  new URL('../data/map.json', import.meta.url),
  JSON.stringify({
    view: { x: round(view.x), y: round(view.y), w: round(view.w), h: round(view.h) },
    // The lon/lat window the terrain raster must be rendered to cover.
    countries, labels, lakes, rivers,
  }) + '\n',
);

const bytes = JSON.stringify(countries).length;
console.log(`${countries.length} countries, ${labels.length} labels, ${lakes.length} lakes, `
  + `${rivers.length} rivers, ${(bytes / 1024).toFixed(0)} KB of country paths`);
console.log(`view ${view.w.toFixed(0)} x ${view.h.toFixed(0)} km, origin ${view.x.toFixed(0)},${view.y.toFixed(0)}`);
