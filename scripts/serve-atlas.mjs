// Server for the atlas. Static files, same as always, plus one real route:
// POST /resolve, which is the one thing that cannot live in the browser — the
// road graph is 772MB and Node-only, so resolving a player's actual plan
// (their order, their car, their departure) has to happen here. See
// docs/superpowers/specs/2026-08-22-infrastructure-decisions.md,
// "server-authoritative simulation" — this is the first real instance of it,
// not a new decision.
//
// Separate from legacy/scripts/serve.mjs, which serves the retired game out of
// legacy/web/. Same shape, different root — not worth sharing a module for.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadGraph, junctionNode } from './lib/road-graph.mjs';
import { buildUrbanField, throughClasses } from './lib/traffic.mjs';
import { loadCars, applyMods } from './lib/cars.mjs';
import { resolveRun, resolveLegWithWaypoint } from './lib/resolve.mjs';

const ROOT = new URL('../atlas/', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8140);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
};

console.log('\n  loading the road graph for /resolve...');
const t0 = Date.now();
const g = loadGraph('data/road-graph');
const urban = buildUrbanField(g);
const through = throughClasses(g);
const cars = loadCars();
const carsById = new Map(cars.map((c) => [c.id, c]));
// Today's incidents come from OUR file, never from the request body. A
// client telling the server what delays apply today is the same mistake as
// a client telling the server its own final time — see
// docs/superpowers/specs/2026-08-22-infrastructure-decisions.md,
// "server-authoritative simulation".
const RACE_DAY = process.env.RACE_DAY || 'data/race-day-2026-08-25.json';
const today = JSON.parse(readFileSync(RACE_DAY, 'utf8'));
console.log(`  ready in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${today.incidents.length} incident(s) today\n`);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function respond(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** carId + mods -> a real car, or an { error } to send straight back. Shared
 * by /resolve and /resolve-detour so a bad car request fails the same way
 * from either. */
function resolveCar(carId, mods) {
  const baseCar = carsById.get(carId);
  if (!baseCar) return { error: `unknown car "${carId}"` };
  try { return { car: applyMods(baseCar, mods || []) }; } catch (e) { return { error: e.message }; }
}

async function handleResolve(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch {
    respond(res, 400, { error: 'invalid JSON body' }); return;
  }
  const { stops, carId, mods, departMinutes } = payload;
  if (!Array.isArray(stops) || stops.length < 2 || typeof departMinutes !== 'number') {
    respond(res, 400, { error: 'need stops[], carId, departMinutes' }); return;
  }
  const { car, error } = resolveCar(carId, mods);
  if (error) { respond(res, 400, { error }); return; }

  const nodeStops = stops.map((s) => ({ name: s.name, node: junctionNode(g, s.lon, s.lat) }));
  const order = nodeStops.map((_, i) => i);
  const result = resolveRun({ g, urban, through }, nodeStops, order, car, departMinutes, today.incidents);
  if (!result) { respond(res, 200, { ok: false, reason: 'unreachable' }); return; }
  respond(res, 200, { ok: true, ...result });
}

/**
 * A player dragged a waypoint onto one leg of their route — force that leg
 * through the dropped point and reprice it. See scripts/lib/resolve.mjs,
 * resolveLegWithWaypoint(): two ordinary searches, no new pathfinding.
 */
async function handleResolveDetour(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch {
    respond(res, 400, { error: 'invalid JSON body' }); return;
  }
  const { from, to, waypoint, carId, mods, departMinutes } = payload;
  if (!from || !to || !Array.isArray(waypoint) || typeof departMinutes !== 'number') {
    respond(res, 400, { error: 'need from, to, waypoint [lon, lat], carId, departMinutes' }); return;
  }
  const { car, error } = resolveCar(carId, mods);
  if (error) { respond(res, 400, { error }); return; }

  const fromStop = { name: from.name, node: junctionNode(g, from.lon, from.lat) };
  const toStop = { name: to.name, node: junctionNode(g, to.lon, to.lat) };
  const leg = resolveLegWithWaypoint({ g, urban, through }, fromStop, toStop, waypoint, car, departMinutes, today.incidents);
  if (!leg) { respond(res, 200, { ok: false, reason: 'unreachable' }); return; }
  respond(res, 200, { ok: true, leg });
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/resolve') { await handleResolve(req, res); return; }
  if (req.method === 'POST' && req.url === '/resolve-detour') { await handleResolveDetour(req, res); return; }

  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = join(ROOT, normalize(path === '/' ? '/index.html' : path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      // Never cache: pulling new code and being served the old map out of the
      // browser cache is a confusing five minutes.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`  Atlas at http://localhost:${PORT}/\n`));
