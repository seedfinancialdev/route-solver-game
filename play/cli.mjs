#!/usr/bin/env node
// Phase 2: the playtest. No UI, no graphics, no map — a numbered list.
//
// It shows exactly what the finished game's map shows and nothing more: where
// the dots are relative to each other, and where the target is. Road distance
// stays hidden until you commit to a hop, because guessing it is the game.
//
// The currency is hours. Road distance is visible — the browser draws the roads
// themselves — so the list shows how long each hop is. What it will not tell you
// is how fast that road runs.
//
//   node play/cli.mjs                 today's puzzle
//   node play/cli.mjs --day 12        a specific day
//   node play/cli.mjs --random
//   node play/cli.mjs --from Porto --to Krakow

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { haversineKm } from '../scripts/lib/geo.mjs';
import { buildGraph, dijkstra, pathFrom } from '../scripts/lib/graph.mjs';

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const g = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')));
const pack = JSON.parse(readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8'));

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const findCity = (q) => g.cities.findIndex((c) => norm(c.name) === norm(q))
  ?? g.cities.findIndex((c) => norm(c.name).startsWith(norm(q)));

let puzzle;
if (flag('from') && flag('to')) {
  const a = findCity(flag('from')), b = findCity(flag('to'));
  if (a < 0 || b < 0) { console.error('unknown city'); process.exit(1); }
  const optimalMin = dijkstra(g, a, (e) => e.min).dist[b];
  puzzle = {
    a, b, optimalMin: Math.round(optimalMin),
    budgetMin: Math.round((optimalMin * pack.budgetMultiplier) / 15) * 15,
  };
} else if (argv.includes('--random')) {
  puzzle = pack.puzzles[Math.floor(Math.random() * pack.puzzles.length)];
} else {
  const epoch = Date.UTC(2026, 0, 1);
  const day = flag('day')
    ? Number(flag('day')) - 1
    : Math.floor((Date.now() - epoch) / 86400000);
  puzzle = pack.puzzles[((day % pack.puzzles.length) + pack.puzzles.length) % pack.puzzles.length];
}

const { a: START, b: TARGET } = puzzle;
const hhmm = (m) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}h${String(Math.round(Math.abs(m)) % 60).padStart(2, '0')}`;
const nm = (i) => g.cities[i].name;
const crow = (i, j) => haversineKm(g.cities[i], g.cities[j]);

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function bearing(from, to) {
  const A = g.cities[from], B = g.cities[to];
  const dx = (B.lon - A.lon) * Math.cos(((A.lat + B.lat) / 2) * Math.PI / 180);
  const dy = B.lat - A.lat;
  const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

const budget = puzzle.budgetMin;
let spent = 0, km = 0, at = START;
const visited = new Set([START]);
const log = [];

const gauge = (remaining) => {
  const frac = Math.max(0, remaining / budget);
  const filled = Math.round(frac * 28);
  const bar = '█'.repeat(filled) + C.dim('─'.repeat(28 - filled));
  const paint = remaining < 0 ? C.red : frac < 0.15 ? C.red : frac < 0.35 ? C.amber : (s) => s;
  return `${paint(hhmm(remaining).padStart(6))}  ${paint(bar)}`;
};

console.log(`\n  ${C.bold(`${nm(START)} → ${nm(TARGET)}`)}   ${C.dim(`${Math.round(crow(START, TARGET))} km as the crow flies`)}`);
console.log(`  ${C.dim(`budget ${hhmm(budget)} of driving · you cannot revisit a city`)}`);
console.log(`  ${C.dim('you can see how long each road is; you cannot see how fast it runs')}\n`);

// A queue rather than readline/promises: piped input arrives in one chunk, and
// `question` only ever captures the line after it was called, so scripted
// playthroughs silently lose most of their moves.
const rl = createInterface({ input, output });
const pending = [];
const waiting = [];
let closed = false;
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : pending.push(line)));
rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null); });
const ask = (prompt) => {
  output.write(prompt);
  if (pending.length) return Promise.resolve(pending.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
};

while (at !== TARGET) {
  const options = g.adj[at]
    .filter((e) => !visited.has(e.to))
    .map((e) => ({ to: e.to, km: e.km, min: e.min, left: crow(e.to, TARGET) }))
    .sort((x, y) => x.left - y.left);

  console.log(`  ${C.bold(nm(at))}  ${gauge(budget - spent)}`);
  if (!options.length) {
    console.log(`\n  ${C.red('dead end')} — nowhere left to go. ${log.length} hops, ${Math.round(spent)} km spent.\n`);
    rl.close(); process.exit(0);
  }
  console.log();
  options.forEach((o, i) => {
    console.log(`   ${String(i + 1).padStart(2)}. ${nm(o.to).padEnd(22)} ${C.dim(
      `${bearing(at, o.to).padEnd(2)}  ${String(o.km).padStart(3)} km of road   `
      + `${String(Math.round(o.left)).padStart(4)} km left to target (crow)`)}`);
  });

  const answer = await ask('\n  > ');
  if (answer === null) { console.log(C.dim('\n  (no input)\n')); rl.close(); process.exit(0); }
  const pick = options[Number(answer.trim()) - 1];
  if (!pick) { console.log(C.dim('  pick a number from the list\n')); continue; }

  spent += pick.min; km += pick.km;
  visited.add(pick.to);
  log.push({ from: at, to: pick.to, km: pick.km, min: pick.min });
  at = pick.to;

  const kmh = pick.km / (pick.min / 60);
  const verdict = kmh < 65 ? C.red('slow road')
    : kmh < 85 ? C.amber('ordinary going')
      : C.green('motorway pace');
  console.log(`\n  paid ${C.bold(hhmm(pick.min))} for ${pick.km} km — ${Math.round(kmh)} km/h, ${verdict}\n`);
}

rl.close();

// --- the reveal ------------------------------------------------------------
const left = budget - spent;
const timeOf = (path) => {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += g.adj[path[i - 1]].find((e) => e.to === path[i]).min;
  return m;
};
const kmOf = (path) => {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += g.adj[path[i - 1]].find((e) => e.to === path[i]).km;
  return d;
};
const fastPath = pathFrom(dijkstra(g, START, (e) => e.min).prev, START, TARGET);
const shortPath = pathFrom(dijkstra(g, START).prev, START, TARGET);

console.log(`  ${C.bold('arrived.')}\n`);
console.log(`  your route       ${hhmm(spent).padStart(6)}   ${String(km).padStart(5)} km  ${log.length} hops`);
console.log(`  the fastest way  ${hhmm(timeOf(fastPath)).padStart(6)}   ${String(kmOf(fastPath)).padStart(5)} km  ${fastPath.length - 1} hops`);
console.log(`  the short way    ${hhmm(timeOf(shortPath)).padStart(6)}   ${String(kmOf(shortPath)).padStart(5)} km  ${C.dim('<- what the map tempts you into')}`);
console.log(`  budget           ${hhmm(budget).padStart(6)}`);
console.log(`  ${left >= 0
  ? C.green(`${C.bold(hhmm(left))} to spare`)
  : C.red(`over budget by ${C.bold(hhmm(-left))}`)}\n`);

console.log(`  ${C.dim('you went')}    ${log.map((h) => nm(h.from)).concat(nm(TARGET)).join(' \u203a ')}`);
console.log(`  ${C.dim('fastest')}     ${fastPath.map(nm).join(' \u203a ')}\n`);

const kmh = (h) => h.km / (h.min / 60);
const slowest = log.slice().sort((x, y) => kmh(x) - kmh(y))[0];
if (slowest && kmh(slowest) < 70) {
  console.log(`  ${C.dim(`your slowest stretch: ${nm(slowest.from)} \u2192 ${nm(slowest.to)}, `
    + `${slowest.km} km at ${Math.round(kmh(slowest))} km/h`)}\n`);
}
console.log(`  ${log.map((h) => (kmh(h) < 65 ? '\u25b2' : kmh(h) < 85 ? '\u25c6' : '\u00b7')).join('')}  `
  + `${left >= 0 ? '+' : '\u2212'}${hhmm(Math.abs(left))}\n`);
