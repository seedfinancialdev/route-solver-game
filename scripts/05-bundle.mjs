// One file for the browser.
//
// Cities and road geometry arrive with projected coordinates already baked in,
// so the page never needs the projection code — it draws the numbers as given.
// The graph ships whole because the game finds the fastest route itself at
// reveal time; that keeps the payload small and lets practice mode play any pair.
//
// Output: web/data.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { project } from './lib/proj.mjs';

const SIMPLIFY_KM = 2.5;   // Douglas-Peucker tolerance. Below ~2 km is detail no
                           // screen shows; above ~4 km a mountain road starts
                           // looking like a motorway, which is the whole tell.

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const graph = read('graph.json');
const map = read('map.json');
const pack = read('puzzles.json');

const round = (v) => Math.round(v * 2) / 2;

/** Douglas-Peucker on projected points. Keeps the road's character, drops noise. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const [ax, ay] = points[lo];
    const [bx, by] = points[hi];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = 0, at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance && at !== -1) {
      keep[at] = 1;
      stack.push([lo, at], [at, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const cities = graph.cities.map((c) => {
  const p = project(c.lon, c.lat);
  return [c.name, c.country, round(p.x), round(p.y)];
});

// [a, b, km, minutes, ...flattened road shape between them]
const edges = graph.edges.map((e) => {
  const projected = (e.geometry || []).map(([lon, lat]) => {
    const p = project(lon, lat);
    return [p.x, p.y];
  });
  const shape = simplify(projected, SIMPLIFY_KM).flatMap(([x, y]) => [round(x), round(y)]);
  return [e.a, e.b, e.km, e.min, ...shape];
});

const bundle = {
  generated: graph.generated,
  view: map.view,
  countries: map.countries.map((c) => c.d),
  cities,
  edges,
  currency: pack.currency,
  budgetMultiplier: pack.budgetMultiplier,
  // [a, b, budgetMin, optimalMin, shortestMin]
  puzzles: pack.puzzles.map((p) => [p.a, p.b, p.budgetMin, p.optimalMin, p.shortestMin]),
};

mkdirSync(new URL('../web/', import.meta.url), { recursive: true });
const out = new URL('../web/data.json', import.meta.url);
writeFileSync(out, JSON.stringify(bundle));

const pts = edges.map((e) => (e.length - 4) / 2);
console.log(`web/data.json — ${(readFileSync(out).length / 1024).toFixed(0)} KB`);
console.log(`  ${cities.length} cities, ${edges.length} roads, ${bundle.puzzles.length} puzzles`);
console.log(`  road shape points per hop: min ${Math.min(...pts)}, median `
  + `${pts.slice().sort((a, b) => a - b)[pts.length >> 1]}, max ${Math.max(...pts)}`);
