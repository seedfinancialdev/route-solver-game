import {
  buildGraph, crow, optimalRoute, newRound, options, hop, remaining,
  hopGlyph, shareString, dayNumber,
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
const best = optimalRoute(g, START, TARGET);
const storeKey = day === null ? null : `route:day:${day}`;

let round = newRound(g, { a: START, b: TARGET, budget: BUDGET });

// --- static map ------------------------------------------------------------
const map = $('map');
const { view } = g;

// Frame the puzzle, not the continent. A wide margin round the two endpoints
// keeps the whole plausible corridor on screen — including the detours — while
// giving the dots enough room to be told apart.
const frame = (() => {
  const a = g.cities[START], b = g.cities[TARGET];
  const pad = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 0.45 + 260;
  const box = {
    x: Math.min(a.x, b.x) - pad,
    y: Math.min(a.y, b.y) - pad,
    w: Math.abs(a.x - b.x) + pad * 2,
    h: Math.abs(a.y - b.y) + pad * 2,
  };
  // Never show more than the map we have.
  box.x = Math.max(box.x, view.x); box.y = Math.max(box.y, view.y);
  box.w = Math.min(box.w, view.x + view.w - box.x);
  box.h = Math.min(box.h, view.y + view.h - box.y);
  return box;
})();
map.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.w} ${frame.h}`);
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
$('budget').textContent = BUDGET.toLocaleString();

// Dots and labels should hold their size on screen, not in map kilometres.
let unit = 1;
function rescale() {
  const box = map.getBoundingClientRect();
  if (!box.width) return;
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
new ResizeObserver(rescale).observe(map);

// --- painting the round ----------------------------------------------------
function accentFor(fraction) {
  return fraction < 0.15 ? 'var(--red)' : fraction < 0.38 ? 'var(--amber)' : 'var(--neutral)';
}

function paint() {
  const left = remaining(round);
  const frac = Math.max(0, left / round.budget);
  app.style.setProperty('--accent', accentFor(frac));
  $('remaining').textContent = Math.round(left).toLocaleString();
  $('gaugeFill').style.transform = `scaleX(${frac})`;

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

  $('reach').replaceChildren(...[...reachable].map((i) => el('line', {
    x1: g.cities[round.at].x, y1: g.cities[round.at].y,
    x2: g.cities[i].x, y2: g.cities[i].y, class: 'reach-line',
  })));

  $('travelled').replaceChildren(...round.hops.map((h) => el('line', {
    x1: g.cities[h.from].x, y1: g.cities[h.from].y,
    x2: g.cities[h.to].x, y2: g.cities[h.to].y, class: 'leg',
  })));

  $('hops').replaceChildren(...round.hops.map((h, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${i + 1}. ${g.cities[h.to].name}`;
    const cost = document.createElement('span');
    cost.textContent = `${h.km} km`;
    const time = document.createElement('em');
    time.textContent = `${Math.floor(h.min / 60)}h${String(h.min % 60).padStart(2, '0')}`;
    cost.append(time);
    li.append(name, cost);
    return li;
  }));
  $('logTotal').textContent = round.hops.length
    ? `${Math.round(round.spent).toLocaleString()} km · ${Math.round(round.minutes / 60)}h on the road`
    : '';
  rescale();
}

function bearingIndex(from, to) {
  const a = g.cities[from], b = g.cities[to];
  const deg = (Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI + 360) % 360;
  return Math.round(deg / 45) % 8;
}

// --- interaction -----------------------------------------------------------
function choose(i) {
  if (round.finished || !options(g, round).some((e) => e.to === i)) return;
  hop(g, round, i);
  paint();
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

function countUp(node, to, ms = 900) {
  const from = 0, started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / ms);
    const eased = 1 - (1 - t) ** 3;
    node.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function finish() {
  if (storeKey) {
    localStorage.setItem(storeKey, JSON.stringify({
      hops: round.hops, spent: round.spent, minutes: round.minutes, deadEnd: round.deadEnd,
    }));
  }

  $('reach').replaceChildren();
  $('optimalRoute').replaceChildren(...best.path.slice(1).map((to, i) => el('line', {
    x1: g.cities[best.path[i]].x, y1: g.cities[best.path[i]].y,
    x2: g.cities[to].x, y2: g.cities[to].y, class: 'best',
  })));

  // Fog lifts: terrain, then the names of everywhere either route went.
  app.dataset.stage = 'reveal';
  const named = new Set([...best.path, ...round.hops.map((h) => h.to), START]);
  const mine = new Set([START, ...round.hops.map((h) => h.to)]);
  [...named].forEach((i, k) => {
    const node = label(i, mine.has(i) ? '' : 'label--best');
    setTimeout(() => node.classList.add('label--on'), 420 + k * 45);
  });

  const left = remaining(round);
  const over = left < 0;
  $('revealVerdict').textContent = round.deadEnd ? 'Dead end.'
    : over ? `Over by ${Math.abs(Math.round(left)).toLocaleString()} km`
      : `${Math.round(left).toLocaleString()} km to spare`;
  $('yourKm').textContent = Math.round(round.spent).toLocaleString();
  $('yourMeta').textContent = `${round.hops.length} hops · ${Math.round(round.minutes / 60)}h`;
  $('bestKm').textContent = best.km.toLocaleString();
  $('bestMeta').textContent = `${best.path.length - 1} hops · ${Math.round(best.minutes / 60)}h`;
  $('budgetKm').textContent = BUDGET.toLocaleString();
  $('glyphs').textContent = round.hops.map(hopGlyph).join('');

  const worst = round.hops.slice().sort((a, b) => (b.km / b.crow) - (a.km / a.crow))[0];
  $('revealNote').textContent = worst && worst.km / worst.crow > 1.25
    ? `The hop that cost you: ${g.cities[worst.from].name} to ${g.cities[worst.to].name} — `
      + `${worst.km} km of road for ${worst.crow} km of map.`
    : 'Your hops all ran close to the straight line. The terrain was on your side.';

  $('reveal').hidden = false;
  countUp($('remaining'), Math.round(left));
  $('caption').textContent = over ? 'over budget' : `unspent of ${BUDGET.toLocaleString()} km`;

  $('share').addEventListener('click', async () => {
    const text = shareString(g, round, day);
    try {
      await navigator.clipboard.writeText(text);
      $('share').textContent = 'Copied';
    } catch {
      $('share').textContent = 'Press ⌘C';
    }
  });
}

// --- restore a finished day ------------------------------------------------
const saved = storeKey && localStorage.getItem(storeKey);
if (saved) {
  const state = JSON.parse(saved);
  for (const h of state.hops) hop(g, round, h.to);
  paint();
  finish();
} else {
  app.dataset.stage = 'playing';
  paint();
}
