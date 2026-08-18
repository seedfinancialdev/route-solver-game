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
if (!existsSync(CLIPPED) || process.env.REBUILD_BOUNDARIES) {
  execFileSync('npx', ['mapshaper', SOURCE.pathname,
    '-clip', 'bbox=-33,25,55,68',
    '-filter-islands', 'min-area=1200km2', 'remove-empty',
    '-simplify', '40%', 'keep-shapes',
    '-filter-fields', 'ISO_A2,NAME',
    '-o', 'format=geojson', 'precision=0.001', CLIPPED.pathname,
  ], { stdio: 'inherit' });
}

const geo = JSON.parse(readFileSync(CLIPPED, 'utf8'));
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

function shapePath(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.map((poly) => poly.map(ringToPath).join('')).join('');
}

// Anything entirely outside the frame is dead weight in the payload.
const inFrame = (geometry) => {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) {
    for (const [lon, lat] of poly[0]) {
      const p = project(lon, lat);
      if (p.x > view.x - 400 && p.x < view.x + view.w + 400
        && p.y > view.y - 400 && p.y < view.y + view.h + 400) return true;
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

writeFileSync(
  new URL('../data/map.json', import.meta.url),
  JSON.stringify({
    view: { x: round(view.x), y: round(view.y), w: round(view.w), h: round(view.h) },
    // The lon/lat window the terrain raster must be rendered to cover.
    countries,
  }) + '\n',
);

const bytes = JSON.stringify(countries).length;
console.log(`${countries.length} countries, ${(bytes / 1024).toFixed(0)} KB of path data`);
console.log(`view ${view.w.toFixed(0)} x ${view.h.toFixed(0)} km, origin ${view.x.toFixed(0)},${view.y.toFixed(0)}`);
