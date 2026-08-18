import {
  buildGraph, crow, roadPath, roadRuns, paceMix, fastestRoute, shortestRoute,
  newRound, options, hop, remaining, hopGlyph, speedOf, hhmm, shareString, dayNumber,
} from './engine.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

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
const best = fastestRoute(g, START, TARGET);
const trap = shortestRoute(g, START, TARGET);
const storeKey = day === null ? null : `route:day:${day}`;

let round = newRound(g, { a: START, b: TARGET, budget: BUDGET });

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
const TILE_ZOOM_KM = 1500;
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

// --- camera ----------------------------------------------------------------
// The frame above is only a starting position. Past that the player drives the
// camera: wheel or pinch to zoom, drag to pan. Once they have taken control we
// stop re-framing under them, and only pan far enough to keep the city they are
// standing in on screen.

const MIN_SPAN_KM = 90;                        // how far in you may go
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
  }
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
      node.setAttribute('aria-label', `city to the ${COMPASS[bearingIndex(round.at, i)]}, about ${km} km away`);
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

  $('travelled').replaceChildren(...round.hops.flatMap((h, i) =>
    paceRuns(h.from, h.to).map((r) => el('path', {
      d: r.d,
      class: `leg pace-${r.tier}${animate && i === round.hops.length - 1 ? ' leg--new' : ''}`,
    }))));

  $('hops').replaceChildren(...round.hops.map((h, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${i + 1}. ${g.cities[h.to].name}`;
    const cost = document.createElement('span');
    cost.textContent = hhmm(h.min);
    const dist = document.createElement('em');
    dist.textContent = `${h.km} km`;
    cost.append(dist);
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

function bearingIndex(from, to) {
  const a = g.cities[from], b = g.cities[to];
  const deg = (Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI + 360) % 360;
  return Math.round(deg / 45) % 8;
}

// --- interaction -----------------------------------------------------------
let paidTimer;
/** What the map suggested, against what the road charged — said out loud, now. */
function showPaid(h) {
  const kmh = speedOf(h);
  const verdict = kmh < 65 ? 'slow road' : kmh < 85 ? 'ordinary going' : 'motorway pace';
  const node = $('paid');
  node.className = `paid paid--on ${kmh < 65 ? 'paid--hard' : kmh < 85 ? 'paid--mid' : 'paid--easy'}`;
  node.innerHTML = '';
  const cost = document.createElement('strong');
  cost.textContent = hhmm(h.min);
  const second = document.createElement('span');
  second.className = 'paid__verdict';
  second.textContent = `${Math.round(kmh)} km/h · ${verdict}`;
  node.append(cost, document.createTextNode(` for ${h.km} km`), second);
  clearTimeout(paidTimer);
  paidTimer = setTimeout(() => node.classList.remove('paid--on'), 4000);
}

function choose(i) {
  if (round.finished || !options(g, round).some((e) => e.to === i)) return;
  hop(g, round, i);
  showPaid(round.hops[round.hops.length - 1]);
  paint({ animate: true });
  followPlayer();
  if (round.finished) finish();
}

dots.forEach((node, i) => {
  node.addEventListener('click', () => { if (!dragged) choose(i); });
  node.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); choose(i); }
  });
  node.addEventListener('pointerenter', () => {
    for (const path of $('reach').children) {
      if (path.dataset.to === String(i)) path.classList.add('reach-line--hot');
    }
  });
  node.addEventListener('pointerleave', () => {
    for (const line of $('reach').children) line.classList.remove('reach-line--hot');
  });
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

function hopsOf(path) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1], to = path[i];
    const edge = g.adj[from].find((e) => e.to === to);
    out.push({ from, to, min: edge.min });
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
  paint();
  await finish();
} else {
  if (saved) localStorage.removeItem(storeKey);
  round = newRound(g, { a: START, b: TARGET, budget: BUDGET });
  app.dataset.stage = 'playing';
  paint();
}
