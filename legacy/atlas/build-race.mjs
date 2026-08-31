// Emits the medal targets for one race on one day.
//
// Record is the best (set, order, departure) the cached checkpoint matrix can
// find, with today's incidents added to the specific legs they name — so a
// closure on the Rome-Milan leg raises Record on any plan that would have
// used it, the same as it would raise a player's own time. Gold/Silver/Bronze
// are +5%/+12%/+25% of Record, per section B of
// docs/superpowers/specs/2026-08-23-run-criteria.md.
//
// This does NOT know about cars — the cached matrix has no notion of one, so
// Record represents the best achievable at legal-limit pace. A player in a
// fast car on a derestricted-heavy plan can beat it; that is a feature, not
// an inconsistency — see legacy/scripts/lib/resolve.mjs.
//
// Output: legacy/atlas/race.json

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadRace } from '../scripts/lib/race.mjs';
import { bestPlanAcrossDepartures } from '../scripts/lib/plan-search.mjs';

const RACE_ID = process.env.RACE || 'grand-tour-menu';
const DAY_FILE = process.env.RACE_DAY || 'data/race-day-2026-08-25.json';
const DEPARTURES = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => h * 60);

const { race, stops, candidates, pick, signature } = loadRace(RACE_ID);

const CACHE = 'data/checkpoint-matrix.json';
if (!existsSync(CACHE)) throw new Error(`no ${CACHE} — run "npm run order:count" first`);
const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
if (cached.signature !== signature) throw new Error(`${CACHE} is for a different stop list — rerun "npm run order:count"`);

const day = existsSync(DAY_FILE) ? JSON.parse(readFileSync(DAY_FILE, 'utf8')) : { incidents: [] };
if (day.race && day.race !== RACE_ID) throw new Error(`${DAY_FILE} is for race "${day.race}", not "${RACE_ID}"`);

// Apply today's incidents to the cached matrix, both directions, before
// searching — the SAME delay a live resolve would add to that leg.
const nameIndex = new Map(stops.map((s, i) => [s.name, i]));
const timed = cached.timed.map((row) => row.map((cell) => cell.map((v) => (v === null ? Infinity : v))));
for (const inc of day.incidents || []) {
  const i = nameIndex.get(inc.from), j = nameIndex.get(inc.to);
  if (i === undefined || j === undefined) throw new Error(`incident names "${inc.from}"/"${inc.to}" not in this race's stops`);
  for (let b = 0; b < cached.buckets; b++) {
    if (Number.isFinite(timed[i][j][b])) timed[i][j][b] += inc.delayMinutes;
    if (Number.isFinite(timed[j][i][b])) timed[j][i][b] += inc.delayMinutes;
  }
}

const matrix = { buckets: cached.buckets, N: stops.length, timed };
const pickSpec = { candidateIds: candidates.map((_, i) => i + 1), pick, start: 0, finish: stops.length - 1 };
const record = bestPlanAcrossDepartures(matrix, pickSpec, DEPARTURES);
if (!record) throw new Error('no plan reaches the finish at any departure — check the race definition');

const medals = {
  record: Math.round(record.minutes),
  gold: Math.round(record.minutes * 1.05),
  silver: Math.round(record.minutes * 1.12),
  bronze: Math.round(record.minutes * 1.25),
};

writeFileSync(new URL('./race.json', import.meta.url), JSON.stringify({
  raceId: RACE_ID,
  name: race.name,
  day: day.date || null,
  worldBuilt: cached.world,
  pick,
  from: stops[0],
  to: stops[stops.length - 1],
  candidates: candidates.map((c) => ({ name: c.name, lon: c.lon, lat: c.lat })),
  incidents: (day.incidents || []).map((i) => ({ from: i.from, to: i.to, note: i.note })),
  medals,
  recordOrder: record.order.map((i) => stops[i].name),
  recordDepartMinutes: record.departMinutes,
}));

const hm = (m) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`;
console.log(`${race.name}: record ${hm(medals.record)} (${record.order.map((i) => stops[i].name).join(' -> ')}, `
  + `depart ${String(record.departMinutes / 60).padStart(2, '0')}:00)`);
console.log(`  gold ${hm(medals.gold)}  silver ${hm(medals.silver)}  bronze ${hm(medals.bronze)}`);
