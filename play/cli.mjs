#!/usr/bin/env node
// Phase 2: the playtest. No UI, no graphics, no map — a numbered list.
//
// It shows exactly what the finished game's map shows and nothing more: where
// the dots are relative to each other, and where the target is. Road distance
// stays hidden until you commit to a hop, because guessing it is the game.
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
  const optimal = dijkstra(g, a).dist[b];
  puzzle = { a, b, optimal: Math.round(optimal), budget: Math.round(optimal * pack.budgetMultiplier / 10) * 10 };
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
const sp = dijkstra(g, TARGET);          // cost from anywhere to the target
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

const budget = puzzle.budget;
let spent = 0, minutes = 0, at = START;
const visited = new Set([START]);
const log = [];

const gauge = (remaining) => {
  const frac = Math.max(0, remaining / budget);
  const filled = Math.round(frac * 28);
  const bar = '█'.repeat(filled) + C.dim('─'.repeat(28 - filled));
  const paint = remaining < 0 ? C.red : frac < 0.15 ? C.red : frac < 0.35 ? C.amber : (s) => s;
  return `${paint(String(Math.round(remaining)).padStart(5))} km  ${paint(bar)}`;
};

console.log(`\n  ${C.bold(`${nm(START)} → ${nm(TARGET)}`)}   ${C.dim(`${Math.round(crow(START, TARGET))} km as the crow flies`)}`);
console.log(`  ${C.dim(`budget ${budget} km · you cannot revisit a city · road distances are hidden until you commit`)}\n`);

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
    .map((e) => ({ to: e.to, km: e.km, min: e.min, hop: crow(at, e.to), left: crow(e.to, TARGET) }))
    .sort((x, y) => x.left - y.left);

  console.log(`  ${C.bold(nm(at))}  ${gauge(budget - spent)}`);
  if (!options.length) {
    console.log(`\n  ${C.red('dead end')} — nowhere left to go. ${log.length} hops, ${Math.round(spent)} km spent.\n`);
    rl.close(); process.exit(0);
  }
  console.log();
  options.forEach((o, i) => {
    console.log(`   ${String(i + 1).padStart(2)}. ${nm(o.to).padEnd(22)} ${C.dim(
      `${bearing(at, o.to)}  ~${String(Math.round(o.hop)).padStart(3)} km away   ${String(Math.round(o.left)).padStart(4)} km left to target (crow)`)}`);
  });

  const answer = await ask('\n  > ');
  if (answer === null) { console.log(C.dim('\n  (no input)\n')); rl.close(); process.exit(0); }
  const pick = options[Number(answer.trim()) - 1];
  if (!pick) { console.log(C.dim('  pick a number from the list\n')); continue; }

  spent += pick.km; minutes += pick.min;
  visited.add(pick.to);
  log.push({ from: at, to: pick.to, km: pick.km, min: pick.min, guess: Math.round(pick.hop) });
  at = pick.to;

  const over = pick.km - pick.hop;
  const verdict = over / pick.hop > 0.35 ? C.red('the road took its time')
    : over / pick.hop > 0.18 ? C.amber('a bit of a detour')
    : C.green('near enough a straight line');
  console.log(`\n  paid ${C.bold(`${pick.km} km`)} (${Math.floor(pick.min / 60)}h${String(pick.min % 60).padStart(2, '0')}) — ${verdict}\n`);
}

rl.close();

// --- the reveal ------------------------------------------------------------
const left = budget - spent;
const optimalPath = pathFrom(dijkstra(g, START).prev, START, TARGET);

console.log(`  ${C.bold('arrived.')}\n`);
console.log(`  your route    ${String(Math.round(spent)).padStart(5)} km  ${log.length} hops  ${Math.round(minutes / 60)}h`);
console.log(`  optimal       ${String(puzzle.optimal).padStart(5)} km  ${optimalPath.length - 1} hops`);
console.log(`  budget        ${String(budget).padStart(5)} km`);
console.log(`  ${left >= 0
  ? C.green(`${C.bold(`${Math.round(left)} km`)} to spare`)
  : C.red(`over budget by ${C.bold(`${Math.round(-left)} km`)}`)}\n`);

console.log(`  ${C.dim('you went')}    ${log.map((h) => nm(h.from)).concat(nm(TARGET)).join(' › ')}`);
console.log(`  ${C.dim('optimal')}     ${optimalPath.map(nm).join(' › ')}\n`);

const worst = log.slice().sort((x, y) => (y.km / y.guess) - (x.km / x.guess))[0];
if (worst && worst.km / worst.guess > 1.25) {
  console.log(`  ${C.dim(`the hop that cost you: ${nm(worst.from)} → ${nm(worst.to)}, `
    + `${worst.km} km of road for ${worst.guess} km of map (${(worst.km / worst.guess).toFixed(2)}x)`)}\n`);
}
console.log(`  ${log.map((h) => (h.km / h.guess > 1.35 ? '▲' : h.km / h.guess > 1.15 ? '◆' : '·')).join('')}  ${left >= 0 ? `+${Math.round(left)}` : Math.round(left)} km\n`);
