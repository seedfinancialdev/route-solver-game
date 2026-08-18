import {
  buildGraph, crow, roadPath, fastestRoute, shortestRoute, newRound, options, hop,
  remaining, hopGlyph, speedOf, hhmm, shareString, dayNumber,
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
for (const attr of [['x', view.x], ['y', view.y], ['width', view.w], ['height', view.h]]) {
  $('terrain').setAttribute(attr[0], attr[1]);
}
for (const d of g.countries) {
  $('countries').append(el('path', { d, class: 'country' }));
  // Straight into the clipPath: a <g> in there is ignored and the terrain
  // silently never appears.
  $('landClip').append(el('path', { d }));
}

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

// Dots and labels should hold their size on screen, not in map kilometres.
let unit = 1;
function layout() {
  const box = map.getBoundingClientRect();
  if (!box.width) return;
  frame = computeFrame();
  map.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.w} ${frame.h}`);
  unit = Math.max(frame.w / box.width, frame.h / box.height);
  for (const [i, node] of dots.entries()) {
    node.setAttribute('r', (node.classList.contains('dot--current') ? 5
      : node.classList.contains('dot--reachable') ? 4.5
        : node.classList.contains('dot--visited') ? 3.2 : 2.6) * unit);
    void i;
  }
  targetRing.setAttribute('r', 9 * unit);
  hereRing.setAttribute('r', 10 * unit);
  hereRing.setAttribute('cx', g.cities[round.at].x);
  hereRing.setAttribute('cy', g.cities[round.at].y);
  for (const label of $('labels').children) label.setAttribute('font-size', 12.5 * unit);
}
new ResizeObserver(layout).observe(map);

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

  // The roads themselves, not straight lines between dots. A switchbacking
  // road and a motorway can be the same length; only the shape says which.
  $('reach').replaceChildren(...[...reachable].map((i) => el('path', {
    d: edgePath(round.at, i), class: 'reach-line',
  })));

  $('travelled').replaceChildren(...round.hops.map((h, i) => el('path', {
    d: edgePath(h.from, h.to),
    class: `leg${animate && i === round.hops.length - 1 ? ' leg--new' : ''}`,
  })));

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
  layout();
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
  if (round.finished) finish();
}

dots.forEach((node, i) => {
  node.addEventListener('click', () => choose(i));
  node.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); choose(i); }
  });
  node.addEventListener('pointerenter', () => {
    const line = $('reach').children[[...options(g, round).map((e) => e.to)].indexOf(i)];
    if (line) line.classList.add('reach-line--hot');
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


function finish() {
  if (storeKey) {
    localStorage.setItem(storeKey, JSON.stringify({
      hops: round.hops, spent: round.spent, km: round.km, deadEnd: round.deadEnd,
    }));
  }

  $('reach').replaceChildren();
  // Both the fastest way and the short way, because the whole lesson is that
  // they are different roads.
  $('optimalRoute').replaceChildren(
    ...trap.path.slice(1).map((to, i) => el('path', {
      d: edgePath(trap.path[i], to), class: 'trap',
    })),
    ...best.path.slice(1).map((to, i) => el('path', {
      d: edgePath(best.path[i], to), class: 'best',
    })),
  );

  // Fog lifts: terrain, then the names of everywhere any of the routes went.
  app.dataset.stage = 'reveal';
  $('labels').replaceChildren();
  const named = new Set([...best.path, ...trap.path, ...round.hops.map((h) => h.to), START]);
  const mine = new Set([START, ...round.hops.map((h) => h.to)]);
  [...named].forEach((i, k) => {
    const node = label(i, mine.has(i) ? '' : 'label--best');
    setTimeout(() => node.classList.add('label--on'), 420 + k * 45);
  });

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
  $('revealNote').textContent = slowest && speedOf(slowest) < 70
    ? `Your slowest stretch: ${g.cities[slowest.from].name} to ${g.cities[slowest.to].name} — `
      + `${slowest.km} km at ${Math.round(speedOf(slowest))} km/h, ${hhmm(slowest.min)} of driving.`
    : 'You kept to fast roads the whole way.';

  $('reveal').hidden = false;
  $('paid').classList.remove('paid--on');

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
  finish();
} else {
  if (saved) localStorage.removeItem(storeKey);
  round = newRound(g, { a: START, b: TARGET, budget: BUDGET });
  app.dataset.stage = 'playing';
  paint();
}
