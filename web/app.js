import {
  buildGraph, crow, roadPath, roadRuns, paceMix, shortestRoute, hosRoute, hosCost,
  newRound, options, hop, remaining, hopGlyph, speedOf, hhmm, shareString, dayNumber,
  bearingWord, narrateHop, requiredPace, previewPace, paceRisk,
  HOS_CONTINUOUS_LIMIT, HOS_BREAK_MIN,
} from './engine.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const app = $('app');
const params = new URLSearchParams(location.search);

const data = await (await fetch('data.json')).json();
const g = buildGraph(data);

// --- which puzzle ----------------------------------------------------------
let day = null, puzzle;
if (params.has('random')) {
  puzzle = data.puzzles[Math.floor(Math.random() * data.puzzles.length)];
} else {
  day = params.has('day') ? Number(params.get('day')) : dayNumber();
  puzzle = data.puzzles[((day - 1) % data.puzzles.length + data.puzzles.length) % data.puzzles.length];
}
const [START, TARGET, BUDGET] = puzzle;
const best = hosRoute(g, START, TARGET);
const trap = shortestRoute(g, START, TARGET);
const storeKey = day === null ? null : `route:day:${day}`;

let round = newRound(g, { a: START, b: TARGET, budget: BUDGET });
// The required pace at the moment each hop was chosen, parallel to
// round.hops — for scoring "needed vs. got" after the fact. Live play only;
// a restored (already-finished) round has no history to reconstruct this
// from, so its log simply shows no delta.
let neededAtHop = [];
// The country shown last, so arriving somewhere new can flash rather than
// silently repaint — same country, quiet update; new country, a beat that
// says "this is worth reading."
let shownCountry = null;

// --- static map ------------------------------------------------------------
const map = $('map');
const { view } = g;

// Frame the puzzle, not the continent. A wide margin round the two endpoints
// keeps the whole plausible corridor on screen — including the detours — while
// giving the dots enough room to be told apart.
//
// The frame has to be grown to the container's aspect ratio here. SVG scales a
// viewBox to *fit*, so any axis we under-ask for gets filled with more map:
// a north-south puzzle in a landscape window was showing 2.2x the width it
// asked for, which is what made the playable area feel like a thumbnail.
let frame = { ...view };
function computeFrame() {
  const box = map.getBoundingClientRect();
  const a = g.cities[START], b = g.cities[TARGET];
  // Enough margin for the detours that are actually worth taking, and no more.
  // Generous padding leaves a portrait screen no room to centre the action:
  // the frame hits the edge of the map and the puzzle slides into a corner.
  const pad = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 0.25 + 200;
  let w = Math.abs(a.x - b.x) + pad * 2;
  let h = Math.abs(a.y - b.y) + pad * 2;

  const aspect = box.width && box.height ? box.width / box.height : w / h;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;

  // Never ask for more map than exists, but do allow the frame to overhang the
  // edge of it. Pinning the frame inside the data pushes a puzzle near the coast
  // into the corner of the screen; the overhang costs nothing, because empty
  // space beyond the map looks exactly like the sea inside it.
  const SLACK = 600;
  w = Math.min(w, view.w);
  h = Math.min(h, view.h);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const x = clamp((a.x + b.x) / 2 - w / 2, view.x - SLACK, view.x + view.w + SLACK - w);
  const y = clamp((a.y + b.y) / 2 - h / 2, view.y - SLACK, view.y + view.h + SLACK - h);
  return { x, y, w, h };
}
// Two relief layers, both positioned over the whole map. The overview paints
// immediately; the detailed one is a couple of megabytes and fades in over the
// top once it has arrived, so the first frame never waits on it. Two elements
// rather than swapping one href, which would fetch the same image twice.
for (const id of ['terrain', 'terrainDetail']) {
  for (const [k, v] of [['x', view.x], ['y', view.y], ['width', view.w], ['height', view.h]]) {
    $(id).setAttribute(k, v);
  }
}
$('terrainDetail').addEventListener('load', () => {
  $('terrainDetail').classList.add('is-ready');
  updateTerrainLayers();
});
$('terrainDetail').setAttribute('href', 'terrain-detail.webp');

// Close work is carried by a grid of tiles at the elevation data's own
// resolution. Only the two or three under the viewport are ever fetched, so
// zooming in gains detail instead of losing it.
const TILE_ZOOM_KM = 850;   // below this the detail pass is being stretched
let tileManifest = null;
const tilesShown = new Set();

async function ensureTerrainTiles() {
  if (!camera || camera.w > TILE_ZOOM_KM) return;
  if (!tileManifest) {
    tileManifest = 'loading';
    try {
      tileManifest = (await (await fetch('terrain-tiles.json')).json()).tiles;
    } catch { tileManifest = []; }
  }
  if (!Array.isArray(tileManifest)) return;
  for (const t of tileManifest) {
    if (tilesShown.has(t.file)) continue;
    const overlaps = t.x < camera.x + camera.w && t.x + t.w > camera.x
      && t.y < camera.y + camera.h && t.y + t.h > camera.y;
    if (!overlaps) continue;
    tilesShown.add(t.file);
    const node = el('image', {
      x: t.x, y: t.y, width: t.w, height: t.h, class: 'terrain-tile', preserveAspectRatio: 'none',
    });
    node.dataset.box = [t.x, t.y, t.w, t.h].join(',');
    node.addEventListener('load', () => { node.classList.add('is-ready'); updateTerrainLayers(); });
    $('terrainTiles').append(node);
    node.setAttribute('href', t.file);
  }
  updateTerrainLayers();
}

/**
 * Exactly one level of relief paints at a time. All three are `overlay`
 * blended, so leaving a coarse layer under a fine one applies the shading
 * twice and the map blows out.
 */
function updateTerrainLayers() {
  if (!camera) return;
  const covered = [...$('terrainTiles').children].filter((node) => {
    if (!node.classList.contains('is-ready')) return false;
    const [x, y, w, h] = node.dataset.box.split(',').map(Number);
    return x < camera.x + camera.w && x + w > camera.x
      && y < camera.y + camera.h && y + h > camera.y;
  });
  const needed = Array.isArray(tileManifest)
    ? tileManifest.filter((t) => t.x < camera.x + camera.w && t.x + t.w > camera.x
      && t.y < camera.y + camera.h && t.y + t.h > camera.y).length
    : 0;
  const tilesActive = camera.w <= TILE_ZOOM_KM && needed > 0 && covered.length === needed;
  const detailReady = $('terrainDetail').classList.contains('is-ready');

  app.dataset.relief = tilesActive ? 'tiles' : detailReady ? 'detail' : 'overview';
}

// --- street-level detail -----------------------------------------------
// Real OSM streets near each playable city (scripts/07-streets.mjs), fetched
// on demand — same lazy-load shape as the terrain tiles above: a small
// manifest loaded once, then only the cities actually inside the viewport,
// only once you're zoomed in close enough for individual streets to be worth
// drawing at all.
const STREET_ZOOM_KM = 14;
let streetManifest = null;
const streetsShown = new Set();

/** Delta-encoded, city-center-relative — decode into absolute map km. */
function decodeStreetRuns(data) {
  return data.runs.map(([tier, ...deltas]) => {
    let x = data.cx, y = data.cy;
    const pts = [];
    for (let i = 0; i < deltas.length; i += 2) {
      x += deltas[i] / data.quant; y += deltas[i + 1] / data.quant;
      pts.push([x, y]);
    }
    return { tier, d: `M${pts.map(([px, py]) => `${px} ${py}`).join('L')}` };
  });
}

async function ensureStreets() {
  if (!camera || camera.w > STREET_ZOOM_KM) return;
  if (!streetManifest) {
    streetManifest = 'loading';
    try { streetManifest = await (await fetch('streets/manifest.json')).json(); } catch { streetManifest = {}; }
  }
  if (streetManifest === 'loading') return;
  for (const [idxStr, geonameid] of Object.entries(streetManifest)) {
    const i = Number(idxStr);
    if (streetsShown.has(i)) continue;
    const c = g.cities[i];
    const near = c.x > camera.x - 5 && c.x < camera.x + camera.w + 5
      && c.y > camera.y - 5 && c.y < camera.y + camera.h + 5;
    if (!near) continue;
    streetsShown.add(i);
    fetch(`streets/${geonameid}.json`).then((r) => r.json()).then((data) => {
      const group = el('g', { class: 'street-city' });
      for (const run of decodeStreetRuns(data)) {
        group.append(el('path', { d: run.d, class: `street street--${run.tier}` }));
      }
      $('streets').append(group);
    }).catch(() => {}); // a city with no street data just shows the plain map, same as any other decoration fallback
  }
}
for (const d of g.rivers) $('rivers').append(el('path', { d, class: 'river' }));
for (const d of g.lakes) $('lakes').append(el('path', { d, class: 'lake' }));

for (const d of g.countries) {
  // Fill below the relief, border above it: a country's colour should be
  // modelled by the terrain, its frontier should not be.
  $('countries').append(el('path', { d, class: 'country' }));
  $('borders').append(el('path', { d, class: 'border-casing' }));
  $('borders').append(el('path', { d, class: 'border' }));
  // Straight into the clipPath: a <g> in there is ignored and the terrain
  // silently never appears.
  $('landClip').append(el('path', { d }));
}

// Country names sit under everything as quiet background typography. Knowing you
// are about to cross into Germany rather than Albania is exactly the sort of
// thing that tells you what the road ahead will be like.
const countryLabels = g.countryLabels.map((c) => {
  const node = el('text', { x: c.x, y: c.y, class: 'country-label' });
  node.textContent = c.name.toUpperCase();
  $('countryLabels').append(node);
  return node;
});

// Named ranges, plateaus and seas — one layer further from the surface than a
// country name, same idea: it says where you are, not which road is quick.
const physicalLabels = g.physicalLabels.map((p) => {
  const node = el('text', { x: p.x, y: p.y, class: `physical-label physical-label--${p.kind}` });
  node.textContent = p.kind === 'sea' ? p.name.toUpperCase() : p.name;
  $('physicalLabels').append(node);
  return node;
});

// A faint lat/long grid, pure chart furniture.
for (const d of g.graticule) $('graticule').append(el('path', { d, class: 'graticule-line' }));

// Built-up footprints. A dot is a city; this is the sprawl a dot can't show —
// static geometry that isn't connected to a single road, so it can't leak
// anything about which one runs fast.
for (const d of g.urbanAreas) $('urban').append(el('path', { d, class: 'urban' }));

// Background towns: everything that would have qualified for the roster but
// lost out to the 75km spacing rule (00-cities.mjs). Unlabelled and inert —
// they connect to nothing, so they can only make the map look lived-in.
const towns = g.towns.map((t) => {
  const node = el('circle', { cx: t.x, cy: t.y, r: 1, class: `town${t.tier ? ' town--big' : ''}` });
  $('towns').append(node);
  return node;
});

const dots = g.cities.map((c) => {
  const node = el('circle', { cx: c.x, cy: c.y, r: 4, class: 'dot' });
  $('dots').append(node);
  return node;
});
const targetRing = el('circle', { cx: g.cities[TARGET].x, cy: g.cities[TARGET].y, r: 9, class: 'dot--target' });
// "You are here" needs to be unmistakable at a glance; the filled dot alone
// reads the same as a selectable neighbour.
const hereRing = el('circle', { r: 10, class: 'dot--here' });
$('dots').append(targetRing, hereRing);

$('origin').textContent = g.cities[START].name;
$('destination').textContent = g.cities[TARGET].name;
$('budget').textContent = hhmm(BUDGET);

// --- the brief ---------------------------------------------------------
// Everything here is already visible once play starts — crow-flies distance,
// the named-ranges/seas layer — just handed over before the first click
// instead of making the player scroll around to find it. It stops at naming
// what's in the way, never which road through it is the quick one: that's
// still the puzzle.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

// The physical-labels source (Natural Earth's geography_regions) writes
// bigger features in ALL CAPS and smaller ones in title case — a size cue
// that works fine as a map label but reads like a typo inline in a sentence
// ("...then CARPATHIAN MOUNTAINS"). Normalised for prose only; the map labels
// keep the source casing.
const titleCase = (s) => s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** Named ranges/plains/seas that sit near the straight line, in travel order. */
function corridorFeatures(aIdx, bIdx, maxKm = 180, limit = 6) {
  const a = g.cities[aIdx], b = g.cities[bIdx];
  const hits = [];
  for (const p of g.physicalLabels) {
    const { d, t } = distToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
    if (d <= maxKm) hits.push({ ...p, name: titleCase(p.name), t });
  }
  hits.sort((x, y) => x.t - y.t);
  return hits.slice(0, limit);
}

function renderBrief() {
  const crowKm = Math.round(crow(g, START, TARGET));
  const kmh = crowKm / (BUDGET / 60);
  const from = g.cities[START], to = g.cities[TARGET];
  $('briefTrip').textContent = `${from.name}, ${from.countryName} → ${to.name}, ${to.countryName}`;
  $('briefStats').textContent = `${crowKm.toLocaleString()} km as the crow flies · ${hhmm(BUDGET)} in the bank`;
  $('briefPace').textContent =
    `That's an average of ${Math.round(kmh)} km/h, door to door, if you drove it in a straight line.`;
  // The one racing rule that applies before a single hop is chosen, not just
  // read off a road: real driving hours (EC 561/2006, simplified). It has to
  // land here, not discovered mid-run, since it changes what "the fastest
  // way" even means before the player commits to anything.
  $('briefRule').textContent =
    `One rule of the road: ${hhmm(HOS_CONTINUOUS_LIMIT)} behind the wheel without a stop forces a `
    + `${HOS_BREAK_MIN}-minute break, charged against your budget like anything else. Plan around it.`;

  const features = corridorFeatures(START, TARGET);
  const seas = features.filter((f) => f.kind === 'sea').map((f) => f.name).slice(0, 2);
  const relief = features.filter((f) => f.kind === 'relief').slice(0, 3);

  const corridor = $('briefCorridor');
  corridor.replaceChildren();
  if (seas.length) {
    const p = document.createElement('p');
    p.className = 'brief__seas';
    p.textContent = `Along the way: the ${seas.join(' and the ')} coast.`;
    corridor.append(p);
  }
  if (relief.length) {
    const ul = document.createElement('ul');
    ul.className = 'brief__relief';
    for (const r of relief) {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = r.name;
      // Real, hand-checked figures for the ranges most players will
      // recognise (03-map.mjs RANGE_FACTS); the generic landform-type note
      // otherwise. No invented specifics for the rest — see 03-map.mjs for
      // why the polygon geometry itself isn't trustworthy for size.
      const facts = r.lengthKm
        ? ` About ${r.lengthKm} km end to end, rising to ${r.peakName} at ${r.peakM.toLocaleString()} m.`
        : '';
      // Real and computed (03-map.mjs paceDeviation): the actual distance-
      // weighted average speed of roads near this region against the
      // network-wide average. Not every range is slow — some, oddly, run
      // faster — which is the entire point of learning this rather than
      // assuming "mountains are slow" and calling it a strategy.
      const pace = r.pacePct != null
        ? ` Roads through here run about ${Math.abs(r.pacePct)}% ${r.pacePct < 0 ? 'slower' : 'faster'} than the network average.`
        : '';
      const blurb = r.blurb ? ` ${r.blurb.charAt(0).toUpperCase()}${r.blurb.slice(1)}.` : '';
      li.append(strong, document.createTextNode(` —${facts}${pace}${blurb}`));
      ul.append(li);
    }
    corridor.append(ul);
  }
}
$('briefStart').addEventListener('click', () => {
  $('brief').hidden = true;
  app.dataset.stage = 'playing';
});

// --- camera ----------------------------------------------------------------
// The frame above is only a starting position. Past that the player drives the
// camera: wheel or pinch to zoom, drag to pan. Once they have taken control we
// stop re-framing under them, and only pan far enough to keep the city they are
// standing in on screen.

// 90 km used to be the real floor — past that scale there was nothing left
// to see, since terrain tiles bottom out around 195 m/px and nothing else
// scaled any finer. Real street-level detail (scripts/07-streets.mjs) changes
// that: a city's data covers roughly a 2 km circle, so the floor comes down
// to let a player actually zoom into one instead of hitting a wall a city
// block above where the streets start being visible at all.
const MIN_SPAN_KM = 3;                          // how far in you may go
const MAX_SPAN_KM = () => view.w * 1.15;       // and how far out

let camera = null;
let userMoved = false;
let unit = 1;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function applyCamera(box) {
  const rect = map.getBoundingClientRect();
  if (!rect.width) return;
  camera = box;
  map.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  unit = Math.max(box.w / rect.width, box.h / rect.height);
  resizeMarks();
  $('resetView').hidden = !userMoved;
}

/** Dots and labels hold their size on screen, not in map kilometres. */
function resizeMarks() {
  for (const node of dots) {
    node.setAttribute('r', (node.classList.contains('dot--current') ? 5
      : node.classList.contains('dot--reachable') ? 4.5
        : node.classList.contains('dot--visited') ? 3.2 : 2.6) * unit);
  }
  targetRing.setAttribute('r', 9 * unit);
  hereRing.setAttribute('r', 10 * unit);
  hereRing.setAttribute('cx', g.cities[round.at].x);
  hereRing.setAttribute('cy', g.cities[round.at].y);
  for (const label of $('labels').children) label.setAttribute('font-size', 12.5 * unit);
  // Country names hold a constant screen size too, but shrink away when the
  // player zooms right in — at that scale they are noise, not orientation.
  const countryPx = camera && camera.w < 900 ? 0 : 16;
  for (const label of countryLabels) label.setAttribute('font-size', countryPx * unit);
  // Physical names (ranges, seas) fade in a touch later than country names —
  // they're the second layer of orientation, not the first — and step away
  // at the same zoom, once the roads themselves are what's worth reading.
  const physicalPx = camera && camera.w < 700 ? 0 : 12.5;
  for (const label of physicalLabels) label.setAttribute('font-size', physicalPx * unit);
  // Background towns hold a constant dot size too, and fade out once the
  // player is zoomed out far enough that they'd just be noise between the
  // cities that matter. They also shrink well below click-target size in a
  // ring around wherever the player is actually standing — a full-size
  // background town parked next to the current city, at the exact zoom a
  // player is scanning for candidates, reads as a missed connection. Shrunk
  // rather than hidden outright: killing them completely was trading away
  // exactly the "lived-in" texture right where the player is looking most.
  const townR = camera && camera.w > 2600 ? 0 : 1;
  const TOWN_KEEPOUT_KM = 120;
  const at = g.cities[round.at];
  towns.forEach((node, i) => {
    const t = g.towns[i];
    const near = Math.hypot(t.x - at.x, t.y - at.y) < TOWN_KEEPOUT_KM;
    const base = node.classList.contains('town--big') ? townR * 1.7 : townR;
    const r = near ? base * 0.4 : base;
    node.setAttribute('r', r * unit);
  });
  for (const chip of $('pacePreview').children) chip.setAttribute('font-size', 11 * unit);
  updateScaleBar();

  // The relief is 1.8 km per pixel at source. Zoomed in past roughly a
  // kilometre per pixel it stops being terrain and starts being blur, so it
  // hands the map over to the roads.
  if (camera) {
    // The relief is 705 m per pixel at best, so past roughly a third of that
    // it stops being terrain and starts being blur. Below 200 km of view it
    // hands the map over to the roads.
    // With tiles down to 353 m per pixel the relief stays useful much deeper
    // than it used to. It never leaves entirely — even stretched, knowing
    // whether you are in a valley or on a plain is worth something — it just
    // steps back so the roads sit clearly on top.
    const fade = Math.max(0, Math.min(1, (camera.w - 90) / 200));
    app.style.setProperty('--terrain-opacity', (0.45 + 0.5 * fade).toFixed(3));
    ensureTerrainTiles();
    updateTerrainLayers();
    ensureStreets();
    $('streets').classList.toggle('streets--visible', camera.w <= STREET_ZOOM_KM);
  }
}

// A road's length is meant to be readable off the map — "you can see exactly
// how long each road is" is the deal the game makes with the player — so a
// scale bar is furniture for a mechanic that's already meant to be visible,
// not a new one. It never reveals a road's *speed*, only confirms its length.
const SCALE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
function updateScaleBar() {
  const rect = map.getBoundingClientRect();
  if (!rect.width || !camera) return;
  const kmPerPx = camera.w / rect.width;
  const targetKm = 110 * kmPerPx;
  const km = SCALE_STEPS.reduce((best, v) => (
    Math.abs(Math.log(v / targetKm)) < Math.abs(Math.log(best / targetKm)) ? v : best), SCALE_STEPS[0]);
  $('scaleBarTick').style.width = `${km / kmPerPx}px`;
  $('scaleBarLabel').textContent = `${km.toLocaleString()} km`;
}

function layout() {
  const rect = map.getBoundingClientRect();
  if (!rect.width) return;
  if (!userMoved) { frame = computeFrame(); applyCamera(frame); return; }
  // Keep the player's zoom through a resize; only correct the aspect ratio.
  const aspect = rect.width / rect.height;
  const w = camera.h * aspect;
  applyCamera({ x: camera.x + (camera.w - w) / 2, y: camera.y, w, h: camera.h });
}
new ResizeObserver(layout).observe(map);

function resetView() {
  userMoved = false;
  layout();
}

/** Screen pixels -> map kilometres, letterboxing and all. */
function toUser(clientX, clientY) {
  const pt = map.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(map.getScreenCTM().inverse());
}

function zoomAt(clientX, clientY, factor) {
  if (!camera) return;
  const p = toUser(clientX, clientY);
  const w = clamp(camera.w * factor, MIN_SPAN_KM, MAX_SPAN_KM());
  const k = w / camera.w;
  userMoved = true;
  applyCamera({
    x: p.x - (p.x - camera.x) * k,
    y: p.y - (p.y - camera.y) * k,
    w, h: camera.h * k,
  });
}

map.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  zoomAt(ev.clientX, ev.clientY, Math.exp(ev.deltaY * 0.0015));
}, { passive: false });

// Drag to pan, with a threshold so a slightly shaky click still picks a city.
const pointers = new Map();
let dragFrom = null;
let pinchFrom = null;
let dragged = false;

map.addEventListener('pointerdown', (ev) => {
  pointers.set(ev.pointerId, ev);
  if (pointers.size === 1) {
    dragged = false;
    dragFrom = { client: { x: ev.clientX, y: ev.clientY }, camera };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchFrom = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    dragFrom = null;
  }
});

map.addEventListener('pointermove', (ev) => {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, ev);

  if (pointers.size === 2 && pinchFrom) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (dist > 0) {
      zoomAt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, pinchFrom.dist / dist);
      pinchFrom.dist = dist;
    }
    return;
  }

  if (!dragFrom || !dragFrom.camera) return;
  const rect = map.getBoundingClientRect();
  const dx = (ev.clientX - dragFrom.client.x) * (dragFrom.camera.w / rect.width);
  const dy = (ev.clientY - dragFrom.client.y) * (dragFrom.camera.h / rect.height);
  if (!dragged && Math.hypot(dx, dy) < unit * 4) return;
  dragged = true;
  userMoved = true;
  map.classList.add('map--dragging');
  applyCamera({ ...dragFrom.camera, x: dragFrom.camera.x - dx, y: dragFrom.camera.y - dy });
});

const endPointer = (ev) => {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinchFrom = null;
  if (pointers.size === 0) { dragFrom = null; map.classList.remove('map--dragging'); }
};
map.addEventListener('pointerup', endPointer);
map.addEventListener('pointercancel', endPointer);
map.addEventListener('dblclick', resetView);
$('resetView').addEventListener('click', resetView);

window.addEventListener('keydown', (ev) => {
  const rect = map.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  if (ev.key === '+' || ev.key === '=') zoomAt(cx, cy, 1 / 1.3);
  else if (ev.key === '-' || ev.key === '_') zoomAt(cx, cy, 1.3);
  else if (ev.key === '0') resetView();
});

/** After a hop, keep the city you are standing in comfortably on screen. */
function followPlayer() {
  if (!userMoved || !camera) return;
  const c = g.cities[round.at];
  const insetX = camera.w * 0.2, insetY = camera.h * 0.2;
  const outside = c.x < camera.x + insetX || c.x > camera.x + camera.w - insetX
    || c.y < camera.y + insetY || c.y > camera.y + camera.h - insetY;
  if (outside) applyCamera({ ...camera, x: c.x - camera.w / 2, y: c.y - camera.h / 2 });
}

// --- painting the round ----------------------------------------------------
function accentFor(fraction) {
  return fraction < 0.15 ? 'var(--red)' : fraction < 0.38 ? 'var(--amber)' : 'var(--neutral)';
}

function paint({ animate = false } = {}) {
  const left = remaining(round);
  const frac = Math.max(0, left / round.budget);
  app.style.setProperty('--accent', accentFor(frac));
  $('gaugeFill').style.transform = `scaleX(${frac})`;
  $('gaugeOver').style.transform = `scaleX(${left < 0 ? Math.min(1, -left / round.budget) : 0})`;
  $('caption').textContent = round.deadEnd ? 'nowhere left to go'
    : left >= 0 ? `${round.finished ? 'left' : 'remaining'} of ${hhmm(round.budget)} driving`
      : `over your ${hhmm(round.budget)} budget`;

  $('remaining').textContent = hhmm(left);

  // The bet, quantified: what average pace the rest of the trip needs, given
  // where you're actually standing and what's actually left of the budget.
  // Pure arithmetic on numbers already on screen — crow-flies distance and
  // remaining time — so it can't leak a single road's speed. It's a floor,
  // not a promise: real roads run longer than the straight line.
  const pace = $('gaugePace');
  const needed = requiredPace(g, round);
  if (round.finished || !Number.isFinite(needed)) {
    pace.replaceChildren();
    pace.className = 'gauge__pace';
  } else {
    const strong = document.createElement('strong');
    strong.textContent = `${Math.round(needed)} km/h`;
    pace.className = `gauge__pace gauge__pace--${paceRisk(needed)}`;
    pace.replaceChildren(document.createTextNode('needs '), strong, document.createTextNode(' minimum from here'));
  }

  // EU driving-hours rule (EC 561/2006, simplified): 4.5 continuous hours
  // force a 45-minute break. This is the player's own status, not a fact
  // about a road — same visibility tier as the budget gauge above it — so it
  // has to be readable before the hop that would trip it, not just after.
  const fatigue = $('gaugeFatigue');
  if (round.finished) {
    fatigue.replaceChildren();
    fatigue.className = 'gauge__fatigue';
  } else {
    const toBreak = HOS_CONTINUOUS_LIMIT - round.sinceRest;
    const strongF = document.createElement('strong');
    strongF.textContent = hhmm(round.sinceRest);
    const tier = toBreak <= 45 ? 'lost' : toBreak <= 90 ? 'tight' : 'ok';
    fatigue.className = `gauge__fatigue gauge__fatigue--${tier}`;
    fatigue.replaceChildren(
      document.createTextNode('behind the wheel '), strongF,
      document.createTextNode(` · ${hhmm(toBreak)} to mandatory break`),
    );
  }

  // Where you actually are, right now: real, sourced legal speed limits
  // (scripts/lib/country-facts.mjs) — the reason a country's measured
  // network pace runs the way it does, made concrete instead of left as an
  // unexplained percentage. Flashes on the stop where it actually changed;
  // a rally crew reads the country you've just crossed into, not the one
  // you've been in for six hops.
  const country = $('hudCountry');
  const here = g.cities[round.at];
  const speed = g.countrySpeed[here.country];
  const justCrossed = shownCountry !== null && shownCountry !== here.country;
  shownCountry = here.country;
  country.classList.toggle('hud__country--crossed', justCrossed);
  if (!speed) {
    country.textContent = here.countryName;
  } else {
    const limits = [
      speed.motorway != null ? `motorway ${speed.motorway}` : 'no motorways',
      `rural ${speed.rural}`, `urban ${speed.urban}`,
    ].join(' · ');
    country.textContent = `${here.countryName} — ${limits}`;
    country.title = speed.note || '';
  }

  const reachable = new Set(options(g, round).map((e) => e.to));
  dots.forEach((node, i) => {
    node.classList.toggle('dot--reachable', reachable.has(i));
    node.classList.toggle('dot--visited', round.visited.has(i) && i !== round.at);
    node.classList.toggle('dot--current', i === round.at);
    node.tabIndex = reachable.has(i) ? 0 : -1;
    if (reachable.has(i)) {
      const km = Math.round(crow(g, round.at, i));
      node.setAttribute('role', 'button');
      // The name is deliberately withheld, so describe the dot the way the map
      // does: a direction and a distance.
      node.setAttribute('aria-label', `city to the ${bearingWord(g, round.at, i)}, about ${km} km away`);
    } else {
      node.removeAttribute('role');
      node.removeAttribute('aria-label');
    }
  });

  labelPlayable(reachable);

  // The roads themselves, drawn the way a road atlas draws them: motorway
  // stretches heavy, slow ones hairline. This is what you weigh before you
  // commit — not how long it will take, but what kind of road it is.
  $('reach').replaceChildren(...[...reachable].flatMap((i) =>
    paceRuns(round.at, i).map((r) => {
      const node = el('path', { d: r.d, class: `reach-line pace-${r.tier}` });
      node.dataset.to = String(i);
      return node;
    })));

  // The comparison itself, not just the ingredients for one: what required
  // pace becomes for each candidate, sitting right on the map next to the
  // dot it's about. An estimate ("~"), not a promise — see previewPace.
  $('pacePreview').replaceChildren(...[...reachable].map((i) => {
    const c = g.cities[i];
    const preview = previewPace(g, round, i);
    const risk = Number.isFinite(preview) ? paceRisk(preview) : 'lost';
    const node = el('text', {
      x: c.x, y: c.y - 14 * unit, class: `pace-chip pace-chip--${risk}`, 'font-size': 11 * unit,
    });
    node.textContent = Number.isFinite(preview) ? `~${Math.round(preview)}` : 'over';
    return node;
  }));

  // Older hops step back rather than staying at full strength: the whole
  // travelled path can zigzag once several hops of real, locally-sound
  // choices are laid end to end, and that history shouldn't out-compete the
  // decision actually in front of you. The most recent hop — how you got to
  // where you're standing — stays fully lit.
  $('travelled').replaceChildren(...round.hops.flatMap((h, i) => {
    const age = round.hops.length - 1 - i;
    const opacity = Math.max(0.35, 1 - age * 0.18);
    return paceRuns(h.from, h.to).map((r) => {
      const node = el('path', {
        d: r.d,
        class: `leg pace-${r.tier}${animate && i === round.hops.length - 1 ? ' leg--new' : ''}`,
      });
      node.style.opacity = opacity;
      return node;
    });
  }));

  $('hops').replaceChildren(...round.hops.map((h, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${i + 1}. ${g.cities[h.to].name}`;
    const cost = document.createElement('span');
    // Needed vs. got, scored: the same bet the pace gauge quantified live,
    // at the moment it was made (neededAtHop), against what the road
    // actually charged. Absent for a restored round — no history to score.
    const wasNeeded = neededAtHop[i];
    if (Number.isFinite(wasNeeded)) {
      const ahead = speedOf(h) >= wasNeeded;
      const delta = document.createElement('b');
      delta.className = `log__delta log__delta--${ahead ? 'ahead' : 'behind'}`;
      delta.textContent = ahead ? '▲' : '▼';
      cost.append(delta);
    }
    cost.append(document.createTextNode(hhmm(h.min)));
    const dist = document.createElement('em');
    dist.textContent = `${h.km} km`;
    cost.append(dist);
    // The break is folded into h.min already; flag it separately, inside the
    // same flex cell as the receipt, so a long number reads as "the clock
    // made you stop" rather than "the road was slow".
    if (h.breakMin > 0) {
      const brk = document.createElement('em');
      brk.className = 'log__break';
      brk.textContent = `+ ${hhmm(h.breakMin)} break`;
      cost.append(brk);
    }
    li.append(name, cost);
    return li;
  }));
  $('logTotal').textContent = round.hops.length
    ? `${hhmm(round.spent)} driving · ${round.km.toLocaleString()} km`
    : '';
  if (camera) resizeMarks(); else layout();
}

/** The road between two adjacent cities, split into runs of one pace. */
function paceRuns(from, to) {
  const edge = g.adj[from].find((e) => e.to === to);
  const runs = edge && roadRuns(edge, g.cities[from], g.cities[to]);
  return runs && runs.length ? runs : [{ tier: 1, d: edgePath(from, to) }];
}

/** The drawn road between two adjacent cities, falling back to a straight line. */
function edgePath(from, to) {
  const edge = g.adj[from].find((e) => e.to === to);
  const road = edge && roadPath(edge, g.cities[from], g.cities[to]);
  return road || `M${g.cities[from].x} ${g.cities[from].y}L${g.cities[to].x} ${g.cities[to].y}`;
}

// --- interaction -----------------------------------------------------------
let paidTimer;
/** What the map suggested, against what the road charged — said out loud, now. */
function showPaid(h) {
  const kmh = speedOf(h);
  const verdict = kmh < 65 ? 'slow road' : kmh < 85 ? 'ordinary going' : 'motorway pace';
  const node = $('paid');
  node.className = `paid paid--on ${kmh < 65 ? 'paid--hard' : kmh < 85 ? 'paid--mid' : 'paid--easy'}`;

  $('paidStory').textContent = narrateHop(g, h);

  const stat = $('paidStat');
  stat.replaceChildren();
  const cost = document.createElement('strong');
  cost.textContent = hhmm(h.min);
  const second = document.createElement('span');
  second.className = 'paid__verdict';
  second.textContent = `${Math.round(kmh)} km/h · ${verdict}`;
  stat.append(cost, document.createTextNode(` for ${h.km} km`), second);
  // A hop that banked enough continuous driving to trip the mandatory-break
  // rule pays for it here — h.min already includes it, so without this the
  // number just looks like a slower road than it actually was.
  if (h.breakMin > 0) {
    const brk = document.createElement('span');
    brk.className = 'paid__break';
    brk.textContent = `+ ${hhmm(h.breakMin)} mandatory break`;
    stat.append(brk);
  }

  clearTimeout(paidTimer);
  paidTimer = setTimeout(() => node.classList.remove('paid--on'), 4000);
}

/**
 * The verdict on the hop that just landed, floating at the city you actually
 * arrived at — where you were looking when it happened — rather than only in
 * the corner HUD. `neededKmh` is the pace the bet was made against, snapshot
 * the instant the hop was chosen (before this one's real cost was known).
 */
let arrivalTimer;
function showArrival(h, neededKmh) {
  $('arrivalCallout').replaceChildren();
  const c = g.cities[h.to];
  const kmh = speedOf(h);
  const ahead = !Number.isFinite(neededKmh) || kmh >= neededKmh;

  const group = el('g', { class: `arrival-callout arrival-callout--${ahead ? 'ahead' : 'behind'}` });
  const headline = el('text', {
    x: c.x, y: c.y - 22 * unit, class: 'arrival-callout__kmh', 'font-size': 15 * unit,
  });
  headline.textContent = `${Math.round(kmh)} km/h`;
  const sub = el('text', {
    x: c.x, y: c.y - 8 * unit, class: 'arrival-callout__delta', 'font-size': 11 * unit,
  });
  sub.textContent = Number.isFinite(neededKmh)
    ? `${ahead ? '▲' : '▼'} ${Math.abs(Math.round(kmh - neededKmh))} ${ahead ? 'above' : 'below'} pace`
    : 'arrived';
  group.append(headline, sub);
  $('arrivalCallout').append(group);

  clearTimeout(arrivalTimer);
  arrivalTimer = setTimeout(() => {
    group.classList.add('arrival-callout--out');
    setTimeout(() => group.remove(), 400);
  }, 2200);
}

/**
 * Draw the hop actually happening — a marker riding the real road geometry —
 * before any state changes. Fast rather than true-to-pace (that's what the
 * reveal race is for): this is about feeling the hop happen, not measuring it.
 */
function animateHop(from, to) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = edgePath(from, to);
  const node = el('path', { d, class: 'hop-preview' });
  const head = el('circle', { r: 5 * unit, class: 'hop-head' });
  $('travelled').append(node, head);
  const len = node.getTotalLength();
  if (reduced || !len) { node.remove(); head.remove(); return Promise.resolve(); }

  node.style.strokeDasharray = `${len}`;
  node.style.strokeDashoffset = `${len}`;
  const duration = Math.min(900, Math.max(280, len * 1.1));

  return new Promise((resolve) => {
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - t) ** 2;
      node.style.strokeDashoffset = `${len * (1 - eased)}`;
      const p = node.getPointAtLength(len * eased);
      head.setAttribute('cx', p.x); head.setAttribute('cy', p.y);
      if (t < 1) requestAnimationFrame(step);
      else { node.remove(); head.remove(); resolve(); }
    };
    requestAnimationFrame(step);
  });
}

let hopBusy = false;
async function choose(i) {
  if (hopBusy || round.finished || !options(g, round).some((e) => e.to === i)) return;
  hopBusy = true;

  // Acknowledge the click before anything else happens: a pulse on the dot
  // you picked, and the road you didn't pick stepping back, so there's no
  // dead beat between doing something and seeing something respond.
  dots[i].classList.add('dot--picked');
  setTimeout(() => dots[i].classList.remove('dot--picked'), 600);
  map.classList.add('map--travelling');
  $('pacePreview').replaceChildren();

  // The bet, snapshot at the moment it was made — before this hop's real
  // cost is known — so the arrival verdict and the hop log can score
  // "needed vs. got" against what the player actually knew when they chose.
  const neededKmh = requiredPace(g, round);

  try {
    await animateHop(round.at, i);
  } finally {
    hopBusy = false;
    map.classList.remove('map--travelling');
  }
  hop(g, round, i);
  neededAtHop.push(neededKmh);
  const h = round.hops[round.hops.length - 1];
  showPaid(h);
  showArrival(h, neededKmh);
  paint({ animate: true });
  followPlayer();
  if (round.finished) finish();
}

/**
 * Recon on a candidate hop, the moment you're actually weighing it: the road
 * you'd be on and the terrain it crosses, both real and both already
 * knowable — the road from OSM's own ref/name (06-road-names.mjs), the
 * terrain from the same measured pace-deviation stat the brief uses, scoped
 * to this one hop instead of the whole trip. Never the thing that's still
 * hidden — how fast the road actually runs — that's still the whole puzzle.
 */
function showRecon(to) {
  const edge = g.adj[round.at].find((e) => e.to === to);
  if (!edge) return;
  const road = edge.road;
  $('reconRoad').textContent = road
    ? (road.share >= 55 ? road.label : `mostly the ${road.label}`)
    : 'unclassified back roads';

  const features = corridorFeatures(round.at, to, 90, 2);
  const terrain = $('reconTerrain');
  terrain.textContent = features
    .map((f) => (f.pacePct != null ? `${f.name} (${f.pacePct > 0 ? '+' : ''}${f.pacePct}%)` : f.name))
    .join(' · ');
  terrain.hidden = !features.length;

  $('recon').hidden = false;
}
function hideRecon() { $('recon').hidden = true; }

dots.forEach((node, i) => {
  node.addEventListener('click', () => { if (!dragged) choose(i); });
  node.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); choose(i); }
  });
  node.addEventListener('pointerenter', () => {
    for (const path of $('reach').children) {
      if (path.dataset.to === String(i)) path.classList.add('reach-line--hot');
    }
    showRecon(i);
  });
  node.addEventListener('pointerleave', () => {
    for (const line of $('reach').children) line.classList.remove('reach-line--hot');
    hideRecon();
  });
  node.addEventListener('focus', () => showRecon(i));
  node.addEventListener('blur', hideRecon);
});

// --- the reveal ------------------------------------------------------------
function label(cityIndex, className = '') {
  const c = g.cities[cityIndex];
  const node = el('text', {
    x: c.x + 8 * unit, y: c.y + 4 * unit,
    class: `label ${className}`, 'font-size': 12.5 * unit,
  });
  node.textContent = c.name;
  $('labels').append(node);
  return node;
}

/**
 * Name the cities you can act on, and only those.
 *
 * The brief called for distant cities as unlabelled specks; I had extended that
 * to the selectable ones too, which left the player with nothing but geometry —
 * no way to know that the hop they are considering crosses the Brenner. Knowing
 * a dot is Innsbruck is the whole difference between reading a map and
 * measuring one.
 */
function labelPlayable(reachable) {
  if (round.finished) return;
  $('labels').replaceChildren();
  for (const i of [round.at, TARGET, ...reachable]) label(i, 'label--on');
}



// --- the race ---------------------------------------------------------------
// Both routes leave the origin together and drive at their real paces: a hop
// that took four hours takes four hours' worth of the animation. You watch the
// fast route pull away, on the stretch where it actually happened.

// best.path is the fastest *legal* route (hosRoute), so re-walking it from a
// fresh driving clock and charging hosCost at each hop reproduces the exact
// same break points hosRoute found — same reasoning as the "you" lane, whose
// hops already carry break-inclusive minutes from hop() itself.
function hopsOf(path) {
  const out = [];
  let sinceRest = 0;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1], to = path[i];
    const edge = g.adj[from].find((e) => e.to === to);
    const cost = hosCost(sinceRest, edge.min);
    out.push({ from, to, min: cost.charged });
    sinceRest = cost.sinceRest;
  }
  return out;
}

function raceRoutes(lanes) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const group = $('race');
  group.replaceChildren();

  const built = lanes.map((lane) => {
    let cursor = 0;
    const segments = lane.hops.map((h) => {
      const node = el('path', {
        d: edgePath(h.from, h.to),
        class: `race-lane race-lane--${lane.key}`,
        'stroke-width': (lane.width || 2.8) * unit,
      });
      group.append(node);
      const len = node.getTotalLength();
      node.style.strokeDasharray = len;
      node.style.strokeDashoffset = len;
      const seg = { node, len, t0: cursor, t1: cursor + h.min };
      cursor += h.min;
      return seg;
    });
    const head = el('circle', {
      r: 4.5 * unit, 'stroke-width': 1.5 * unit, class: `race-head race-head--${lane.key}`,
    });
    group.append(head);
    return { ...lane, segments, head, total: cursor };
  });

  const total = Math.max(...built.map((l) => l.total));
  const clock = $('raceClock');

  const drawAt = (virtual) => {
    for (const lane of built) {
      let head = null;
      for (const seg of lane.segments) {
        if (virtual >= seg.t1) {
          seg.node.style.strokeDashoffset = 0;
          head = seg.node.getPointAtLength(seg.len);
        } else if (virtual > seg.t0) {
          const done = (virtual - seg.t0) / (seg.t1 - seg.t0);
          seg.node.style.strokeDashoffset = seg.len * (1 - done);
          head = seg.node.getPointAtLength(seg.len * done);
        }
      }
      if (head) { lane.head.setAttribute('cx', head.x); lane.head.setAttribute('cy', head.y); }
      lane.head.classList.toggle('race-head--done', virtual >= lane.total);
    }
    clock.hidden = false;
    clock.innerHTML = '';
    const t = document.createElement('strong');
    t.textContent = hhmm(Math.min(virtual, total));
    const who = document.createElement('em');
    const arrived = built.filter((l) => virtual >= l.total).map((l) => l.label);
    who.textContent = arrived.length ? `  ${arrived.join(' and ')} arrived` : '  on the road';
    const skip = document.createElement('b');
    skip.textContent = 'click to skip';
    clock.append(t, who, skip);
  };

  if (reduced) { drawAt(total); return Promise.resolve(); }

  // Long enough to watch the gap open. A whole day of driving takes about a
  // second and a half, and impatience is handled by letting people skip.
  const duration = Math.min(13000, Math.max(7000, total * 7));
  return new Promise((resolve) => {
    const started = performance.now();
    let done = false;
    const finishNow = () => {
      if (done) return;
      done = true;
      window.removeEventListener('pointerdown', finishNow);
      window.removeEventListener('keydown', finishNow);
      drawAt(total);
      setTimeout(resolve, 200);
    };
    window.addEventListener('pointerdown', finishNow);
    window.addEventListener('keydown', finishNow);
    const step = (now) => {
      if (done) return;
      const t = Math.min(1, (now - started) / duration);
      drawAt(t * total);
      if (t < 1) requestAnimationFrame(step);
      else finishNow();
    };
    requestAnimationFrame(step);
  });
}

/** Frame both routes, so nothing important happens off screen. */
function frameRoutes(paths) {
  const all = paths.flat().map((i) => g.cities[i]);
  const pad = 160;
  const box = {
    x: Math.min(...all.map((c) => c.x)) - pad,
    y: Math.min(...all.map((c) => c.y)) - pad,
  };
  box.w = Math.max(...all.map((c) => c.x)) + pad - box.x;
  box.h = Math.max(...all.map((c) => c.y)) + pad - box.y;
  const rect = map.getBoundingClientRect();
  const aspect = rect.width / rect.height;
  if (box.w / box.h < aspect) {
    const w = box.h * aspect; box.x -= (w - box.w) / 2; box.w = w;
  } else {
    const h = box.w / aspect; box.y -= (h - box.h) / 2; box.h = h;
  }
  applyCamera(box);
}

async function finish() {
  if (storeKey) {
    localStorage.setItem(storeKey, JSON.stringify({
      hops: round.hops, spent: round.spent, km: round.km, deadEnd: round.deadEnd,
    }));
  }

  $('reach').replaceChildren();
  clearTimeout(arrivalTimer);
  $('arrivalCallout').replaceChildren();

  // The terrain has been there all along; what the reveal adds is the names of
  // everywhere the routes went, and then the race.
  app.dataset.stage = 'reveal';
  $('labels').replaceChildren();
  const named = new Set([...best.path, ...trap.path, ...round.hops.map((h) => h.to), START]);
  const mine = new Set([START, ...round.hops.map((h) => h.to)]);
  [...named].forEach((i, k) => {
    const node = label(i, mine.has(i) ? '' : 'label--best');
    setTimeout(() => node.classList.add('label--on'), 420 + k * 45);
  });

  // Now run them side by side. The static routes only appear once the race is
  // over, so nothing is given away while it is still driving.
  $('paid').classList.remove('paid--on');
  frameRoutes([round.hops.map((h) => h.to).concat(START), best.path]);
  $('travelled').replaceChildren();
  // The fastest way goes down first and wider: the two routes share their
  // opening hops on most puzzles, and the player should always be able to see
  // their own line riding on top of it until the moment they part.
  await raceRoutes([
    { key: 'best', label: 'the fastest way', hops: hopsOf(best.path), width: 5 },
    { key: 'you', label: 'you', hops: round.hops, width: 2.6 },
  ]);
  $('race').replaceChildren();
  $('raceClock').hidden = true;
  paint();
  $('optimalRoute').replaceChildren(
    ...trap.path.slice(1).map((to, i) => el('path', {
      d: edgePath(trap.path[i], to), class: 'trap',
    })),
    ...best.path.slice(1).flatMap((to, i) =>
      paceRuns(best.path[i], to).map((r) => el('path', { d: r.d, class: `best pace-${r.tier}` }))),
  );

  const left = remaining(round);
  $('revealVerdict').textContent = round.deadEnd ? 'Dead end.'
    : left < 0 ? `Over by ${hhmm(-left)}` : `${hhmm(left)} to spare`;
  $('yourKm').textContent = hhmm(round.spent);
  $('yourMeta').textContent = `${round.km.toLocaleString()} km · ${round.hops.length} hops`;
  $('bestKm').textContent = hhmm(best.minutes);
  $('bestMeta').textContent = `${best.km.toLocaleString()} km · ${best.path.length - 1} hops`;
  $('trapKm').textContent = hhmm(trap.minutes);
  $('trapMeta').textContent = `${trap.km.toLocaleString()} km`;
  $('budgetKm').textContent = hhmm(BUDGET);
  $('glyphs').textContent = round.hops.map(hopGlyph).join('');

  const slowest = round.hops.slice().sort((a, b) => speedOf(a) - speedOf(b))[0];
  if (slowest && speedOf(slowest) < 70) {
    const edge = g.adj[slowest.from].find((e) => e.to === slowest.to);
    const [slow, ordinary, fast] = edge ? paceMix(edge) : [0, 1, 0];
    const why = fast < 0.05 ? 'no motorway on it at all'
      : fast < 0.25 ? `motorway for only ${Math.round(fast * 100)}% of the way`
        : slow > 0.5 ? `over half of it slow road` : 'slow going most of the way';
    $('revealNote').textContent =
      `Your slowest stretch: ${g.cities[slowest.from].name} to ${g.cities[slowest.to].name} — `
      + `${slowest.km} km at ${Math.round(speedOf(slowest))} km/h, ${hhmm(slowest.min)} of driving. `
      + `There was ${why}.`;
    void ordinary;
  } else {
    $('revealNote').textContent = 'You kept to fast roads the whole way.';
  }

  $('reveal').hidden = false;
  userMoved = false;
  $('resetView').hidden = true;

  $('share').addEventListener('click', async () => {
    const text = shareString(g, round, day);
    try {
      await navigator.clipboard.writeText(text);
      $('share').textContent = 'Copied';
    } catch {
      $('share').textContent = 'Press \u2318C';
    }
  });
}

// --- restore a finished day ------------------------------------------------
// A saved result only restores if it still describes a legal round. Regenerating
// the puzzle set repoints a day at a different pair, and replaying yesterday's
// hops onto it would silently produce a finished round that never happened.
function restore(saved) {
  const state = JSON.parse(saved);
  if (!Array.isArray(state.hops) || !state.hops.length) return false;
  for (const h of state.hops) hop(g, round, h.to);
  if (!round.finished) return false;
  return true;
}

const saved = storeKey && localStorage.getItem(storeKey);
let restored = false;
try {
  restored = saved ? restore(saved) : false;
} catch { restored = false; }

if (restored) {
  $('brief').hidden = true;
  paint();
  await finish();
} else {
  if (saved) localStorage.removeItem(storeKey);
  round = newRound(g, { a: START, b: TARGET, budget: BUDGET });
  renderBrief();
  $('brief').hidden = false;
  app.dataset.stage = 'brief';
  paint();
}
