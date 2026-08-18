// Phase 4, step 3: one file for the browser.
//
// Cities arrive with their projected coordinates already baked in, so the page
// never needs the projection code — it draws the numbers as given. The graph
// ships whole because the game finds the optimal route itself at reveal time;
// that keeps the payload small and lets practice mode play any pair.
//
// Output: web/data.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { project } from './lib/proj.mjs';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const graph = read('graph.json');
const map = read('map.json');
const pack = read('puzzles.json');

const round = (v) => Math.round(v * 2) / 2;
const bundle = {
  generated: graph.generated,
  view: map.view,
  countries: map.countries.map((c) => c.d),
  // [name, country, x, y]
  cities: graph.cities.map((c) => {
    const p = project(c.lon, c.lat);
    return [c.name, c.country, round(p.x), round(p.y)];
  }),
  // [a, b, km, minutes]
  edges: graph.edges.map((e) => [e.a, e.b, e.km, e.min]),
  budgetMultiplier: pack.budgetMultiplier,
  // [a, b, budget]  — optimal is recomputed in the browser
  puzzles: pack.puzzles.map((p) => [p.a, p.b, p.budget]),
};

mkdirSync(new URL('../web/', import.meta.url), { recursive: true });
const out = new URL('../web/data.json', import.meta.url);
writeFileSync(out, JSON.stringify(bundle));
console.log(`web/data.json — ${(readFileSync(out).length / 1024).toFixed(0)} KB, `
  + `${bundle.cities.length} cities, ${bundle.edges.length} edges, ${bundle.puzzles.length} puzzles`);
