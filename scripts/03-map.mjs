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
import { project, unproject } from './lib/proj.mjs';
import { haversineKm } from './lib/geo.mjs';
import { inGameEurope, parseRow } from './lib/cities.mjs';

const PAD_KM = 260;          // breathing room around the outermost city
const QUANT = 20;            // round coordinates to 1/20 km; the map zooms to 90 km across

// The clip window is a few degrees wider than the projected view on every side,
// so mapshaper's straight clip edges fall outside the frame instead of drawing
// a false coastline across the corner of the map. Islands below 1200 km2 go:
// at this simplification they survive as triangles, which read as artefacts.
// 1:10m rather than 1:50m. At 50m scale a border has kilometres between its
// vertices, which is fine at continental zoom and a polygon close up — and the
// player can zoom to 90 km across.
const SOURCE = new URL('../data/raw/ne_10m_admin_0_countries.geojson', import.meta.url);
const CLIPPED = new URL('../data/raw/europe.geojson', import.meta.url);
const CLIP_BOX = 'bbox=-33,25,55,68';
if (!existsSync(CLIPPED) || process.env.REBUILD_BOUNDARIES) {
  execFileSync('npx', ['mapshaper', SOURCE.pathname,
    '-clip', CLIP_BOX,
    '-filter-islands', 'min-area=1200km2', 'remove-empty',
    '-simplify', '18%', 'keep-shapes',
    // LABEL_X/LABEL_Y are Natural Earth's own placements for a country's name,
    // which beat a centroid for awkward shapes like Norway or Croatia.
    '-filter-fields', 'ISO_A2,NAME,LABEL_X,LABEL_Y,LABELRANK',
    '-o', 'format=geojson', 'precision=0.001', CLIPPED.pathname,
  ], { stdio: 'inherit' });
}

// Clip-and-cache, the same recipe for every Natural Earth layer that isn't the
// admin-0 boundaries: water, urban footprints, named physical regions. Half
// the detours on this map are a road going round a lake or waiting for a
// bridge, and without it the player is asked to explain a bend they cannot
// see the reason for.
function prepareClipped(name, args) {
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
const lakesGeo = prepareClipped('ne_10m_lakes',
  ['-filter', 'scalerank <= 6', '-simplify', '70%', 'keep-shapes', '-filter-fields', 'name']);
const riversGeo = prepareClipped('ne_10m_rivers_lake_centerlines',
  ['-filter', 'scalerank <= 7', '-simplify', '70%', 'keep-shapes', '-filter-fields', 'name']);

// Built-up footprints — decoration, not data. A city on this map is a dot
// standing for a real place; this is what gives Paris, the Ruhr and the
// Randstad the sprawl a dot alone can't show. Static geometry, unconnected to
// any road, so it cannot leak anything about which one runs fast.
const urbanGeo = prepareClipped('ne_10m_urban_areas',
  ['-filter', 'area_sqkm >= 60', '-simplify', '18%', 'keep-shapes', '-filter-fields', 'area_sqkm']);

// Named mountain ranges, plateaus, plains and peninsulas. The hillshade
// already shows a player they're heading into the Carpathians; naming the
// range adds orientation, not information — it says nothing about which of
// the several roads through it is the quick one.
const RELIEF_CLASSES = new Set(['Range/mtn', 'Plateau', 'Plain', 'Basin', 'Lowland', 'Pen/cape']);
const reliefGeo = prepareClipped('ne_10m_geography_regions_polys',
  ['-filter-fields', 'FEATURECLA,NAME']);

// Sea names — Adriatic, Aegean, Tyrrhenian, Baltic — the coastline's own
// orientation layer.
const marineGeo = prepareClipped('ne_10m_geography_marine_polys',
  ['-filter', 'min_label <= 5', '-simplify', '60%', 'keep-shapes', '-filter-fields', 'featurecla,name,min_label']);

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

/**
 * A label point for a named region with no LABEL_X/Y of its own (unlike the
 * admin-0 countries). The vertex average of an arc-shaped range like the Alps
 * or the Carpathians isn't the true area centroid, but it lands inside the
 * shape and that's all a quiet background label needs.
 */
function roughCentroid(geometry) {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates
    : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
      : [];
  let sx = 0, sy = 0, n = 0;
  for (const ring of rings) for (const [lon, lat] of ring) {
    const p = project(lon, lat);
    sx += p.x; sy += p.y; n++;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

// spanKm was tried as the convex-hull diameter of the region's own polygon —
// then checked against reality before shipping. ne_10m_geography_regions_polys
// is built for label placement across zoom levels, not as an accurate
// boundary: the polygon behind "Tatra Mts." spans 18.0-23.1°E, ~366 km,
// against a real Tatras that are about 60 km end to end — a 6x miss. Some
// features came out close (Pyrenees: computed 468 km vs a real ~430 km); the
// error isn't consistent enough to correct for. A wrong number that looks
// measured is worse than no number, so the geometry isn't used for size at
// all now — only real, independently-sourced figures below, or none.
//
// FACTS is hand-curated (length in km, highest point in m) for the named
// ranges a player is actually likely to recognise, checked against general
// reference knowledge rather than this dataset. Anything not in here gets
// the type-blurb only — no invented specific. Matched on the exact NE name
// string, before the display-only title-casing app.js applies.
const RANGE_FACTS = {
  ALPS: { lengthKm: 1200, peak: ['Mont Blanc', 4809] },
  PYRENEES: { lengthKm: 430, peak: ['Aneto', 3404] },
  'CARPATHIAN MOUNTAINS': { lengthKm: 1500, peak: ['Gerlachovský štít', 2655] },
  'Tatra Mts.': { lengthKm: 60, peak: ['Gerlachovský štít', 2655] },
  'Dinaric Alps': { lengthKm: 645, peak: ['Maja Jezercë', 2694] },
  APPENNINI: { lengthKm: 1200, peak: ['Corno Grande', 2912] },
  'Balkan Mts.': { lengthKm: 530, peak: ['Botev Peak', 2376] },
  Vosges: { lengthKm: 120, peak: ['Grand Ballon', 1424] },
  Jura: { lengthKm: 360, peak: ['Crêt de la Neige', 1720] },
  Harz: { lengthKm: 110, peak: ['Brocken', 1141] },
  Erzgebirge: { lengthKm: 150, peak: ['Klínovec', 1244] },
  'Sudetes Mts.': { lengthKm: 300, peak: ['Śnieżka', 1603] },
  'Cord. Cantábrica': { lengthKm: 300, peak: ['Torre de Cerredo', 2650] },
  'S. Nevada': { lengthKm: 90, peak: ['Mulhacén', 3479] },
  'Pindus Mts.': { lengthKm: 160, peak: ['Smolikas', 2637] },
  'KJØLEN MOUNTAINS': { lengthKm: 1700, peak: ['Galdhøpiggen', 2469] },
  'Grampian Mts.': { lengthKm: 400, peak: ['Ben Nevis', 1345] },
  Böhmerwald: { lengthKm: 100, peak: ['Großer Arber', 1456] },
};

// What kind of going a landform generally implies — true of the type, not a
// specific claim about any one range. This is the fallback (and, for ranges
// without a RANGE_FACTS entry, the whole of it) — real peak/length data is a
// natural follow-on for more of these once the DEM-based colour terrain
// (phase 6) is in place and peak elevation can be sampled from that raster
// instead of hand-curated one range at a time.
const RELIEF_BLURB = {
  'Range/mtn': 'a mountain range — roads through it tend to climb, switchback, and slow down',
  Plateau: 'raised, fairly level tableland — higher ground, but usually straighter going than true mountains',
  Plain: 'flat, low-lying ground — typically the easiest terrain on the map to build a fast road across',
  Basin: 'a lower-lying depression ringed by higher ground',
  Lowland: 'flat, low ground — like a plain, usually easy going for a road',
  'Pen/cape': 'a peninsula — the coastline tends to shape which roads exist',
};

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

const urbanAreas = urbanGeo.features
  .filter((f) => inFrame(f.geometry))
  .map((f) => shapePath(f.geometry))
  .filter(Boolean);

// How much slower (or faster) the roads actually near a named region run,
// against the network-wide average — real, computed from the same OSRM
// measurements every hop's pace tier already comes from, not a guess at
// "mountains are slow." A region's own labelled polygon isn't trustworthy
// for size (see RANGE_FACTS above) but is a fine coarse filter for "which
// edges pass near here": edges are bucketed by the midpoint of their real
// driven geometry, not by the unreliable polygon boundary itself.
const NETWORK_KMH = graph.edges.reduce((s, e) => s + e.km, 0)
  / (graph.edges.reduce((s, e) => s + e.min, 0) / 60);
const PACE_SAMPLE_RADIUS_KM = 70;
const PACE_MIN_EDGES = 4; // below this the percentage is noise, not a fact

function paceDeviation(regionX, regionY) {
  let km = 0, min = 0, n = 0;
  for (const e of graph.edges) {
    const geo = e.geometry;
    if (!geo || !geo.length) continue;
    const [lon, lat] = geo[Math.floor(geo.length / 2)];
    const p = project(lon, lat);
    if (Math.hypot(p.x - regionX, p.y - regionY) > PACE_SAMPLE_RADIUS_KM) continue;
    km += e.km; min += e.min; n++;
  }
  if (n < PACE_MIN_EDGES) return null;
  const kmh = km / (min / 60);
  return { pct: Math.round((kmh - NETWORK_KMH) / NETWORK_KMH * 100), n };
}

// Named physical regions and seas, merged into one quiet-typography layer.
// `kind` lets the browser style a mountain range differently from a sea —
// both read as background orientation, neither as gameplay information.
const reliefLabels = reliefGeo.features
  .filter((f) => RELIEF_CLASSES.has(f.properties.FEATURECLA) && inFrame(f.geometry))
  .map((f) => {
    const p = roughCentroid(f.geometry);
    if (!p) return null;
    const facts = RANGE_FACTS[f.properties.NAME] || null;
    const pace = paceDeviation(round(p.x), round(p.y));
    return {
      name: f.properties.NAME, x: round(p.x), y: round(p.y), kind: 'relief',
      featurecla: f.properties.FEATURECLA,
      lengthKm: facts ? facts.lengthKm : null,
      peakName: facts ? facts.peak[0] : null,
      peakM: facts ? facts.peak[1] : null,
      blurb: RELIEF_BLURB[f.properties.FEATURECLA] || null,
      pacePct: pace ? pace.pct : null,
    };
  })
  .filter(Boolean)
  .filter((l) => l.x > view.x && l.x < view.x + view.w && l.y > view.y && l.y < view.y + view.h);

const MARINE_CLASSES = new Set(['sea', 'gulf', 'ocean']);
const marineLabels = marineGeo.features
  .filter((f) => MARINE_CLASSES.has(f.properties.featurecla) && inFrame(f.geometry))
  .map((f) => {
    const p = roughCentroid(f.geometry);
    return p && { name: f.properties.name, x: round(p.x), y: round(p.y), kind: 'sea' };
  })
  .filter(Boolean)
  .filter((l) => l.x > view.x && l.x < view.x + view.w && l.y > view.y && l.y < view.y + view.h);

const physicalLabels = [...reliefLabels, ...marineLabels];

// --- background towns --------------------------------------------------
// The playable roster is spaced >=75km apart on purpose (00-cities.mjs) —
// without that the Ruhr and the Randstad eat the budget. That's exactly what
// leaves the map looking empty between the dots you can act on. These are the
// GeoNames places that would have qualified for the roster but didn't — same
// source, same country/bbox filter — drawn small, unlabelled and inert: they
// connect to nothing, so they can't hint at which road is fast.
const MIN_TOWN_SPACING_KM = 20;
const onRoster = new Set(graph.cities.map((c) => c.geonameid));
const rawTowns = readFileSync(new URL('../data/raw/cities15000.txt', import.meta.url), 'utf8');
const townCandidates = [];
for (const line of rawTowns.split('\n')) {
  if (!line) continue;
  const row = parseRow(line);
  if (!inGameEurope(row) || onRoster.has(row.id)) continue;
  townCandidates.push(row);
}
townCandidates.sort((a, b) => b.population - a.population);
const pickedTowns = [];
for (const t of townCandidates) {
  const tooClose = pickedTowns.some((p) => haversineKm(p, t) < MIN_TOWN_SPACING_KM);
  if (!tooClose) pickedTowns.push(t);
}
const towns = pickedTowns
  .map((t) => {
    const p = project(t.lon, t.lat);
    return { x: round(p.x), y: round(p.y), tier: t.population >= 50000 ? 1 : 0 };
  })
  .filter((t) => t.x > view.x && t.x < view.x + view.w && t.y > view.y && t.y < view.y + view.h);

// --- graticule -----------------------------------------------------------
// A latitude/longitude grid, computed rather than fetched — the projection
// already round-trips (project/unproject), so this costs no new data source.
// Pure chart furniture: it tells you nothing a road doesn't.
const GRID_STEP = 5; // degrees
const corners = [
  unproject(view.x, view.y), unproject(view.x + view.w, view.y),
  unproject(view.x, view.y + view.h), unproject(view.x + view.w, view.y + view.h),
];
const lons = corners.map((c) => c.lon), lats = corners.map((c) => c.lat);
const lonLo = Math.floor(Math.min(...lons) / GRID_STEP - 1) * GRID_STEP;
const lonHi = Math.ceil(Math.max(...lons) / GRID_STEP + 1) * GRID_STEP;
const latLo = Math.floor(Math.min(...lats) / GRID_STEP - 1) * GRID_STEP;
const latHi = Math.ceil(Math.max(...lats) / GRID_STEP + 1) * GRID_STEP;
const SAMPLES = 24;
const pointsToPath = (pts) => {
  let d = '', px = null, py = null;
  for (const [x0, y0] of pts) {
    const x = round(x0), y = round(y0);
    if (x === px && y === py) continue;
    d += d === '' ? `M${x} ${y}` : `L${x} ${y}`;
    px = x; py = y;
  }
  return d;
};
const graticule = [];
for (let lon = lonLo; lon <= lonHi; lon += GRID_STEP) {
  const pts = Array.from({ length: SAMPLES }, (_, i) => {
    const lat = latLo + (i / (SAMPLES - 1)) * (latHi - latLo);
    const p = project(lon, lat);
    return [p.x, p.y];
  });
  graticule.push(pointsToPath(pts));
}
for (let lat = latLo; lat <= latHi; lat += GRID_STEP) {
  const pts = Array.from({ length: SAMPLES }, (_, i) => {
    const lon = lonLo + (i / (SAMPLES - 1)) * (lonHi - lonLo);
    const p = project(lon, lat);
    return [p.x, p.y];
  });
  graticule.push(pointsToPath(pts));
}

writeFileSync(
  new URL('../data/map.json', import.meta.url),
  JSON.stringify({
    view: { x: round(view.x), y: round(view.y), w: round(view.w), h: round(view.h) },
    // The lon/lat window the terrain raster must be rendered to cover.
    countries, labels, lakes, rivers, urbanAreas, physicalLabels, towns, graticule,
  }) + '\n',
);

const bytes = JSON.stringify(countries).length;
console.log(`${countries.length} countries, ${labels.length} labels, ${lakes.length} lakes, `
  + `${rivers.length} rivers, ${(bytes / 1024).toFixed(0)} KB of country paths`);
console.log(`${urbanAreas.length} urban footprints, ${physicalLabels.length} physical/sea labels `
  + `(${reliefLabels.length} relief, ${marineLabels.length} sea), ${towns.length} background towns `
  + `from ${townCandidates.length} candidates, ${graticule.length} graticule lines`);
console.log(`view ${view.w.toFixed(0)} x ${view.h.toFixed(0)} km, origin ${view.x.toFixed(0)},${view.y.toFixed(0)}`);
