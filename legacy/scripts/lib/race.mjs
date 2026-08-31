// The race a gate is measuring, read from data/runs.json.
//
// Both the ordering gates and the fuel gate need the same list of stops in the
// same order, and they share a cached cost matrix keyed on it. Deriving that
// list from the data file rather than duplicating it in each script is what
// keeps the cache valid across them.

import { readFileSync } from 'node:fs';

export function loadRace(id) {
  const runs = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs;
  const race = runs.find((r) => r.id === id);
  if (!race) throw new Error(`no race "${id}" in data/runs.json`);
  const candidates = race.menu ?? race.checkpoints ?? [];
  const stops = [race.from, ...candidates, race.to];
  return {
    race,
    stops,
    candidates,
    pick: race.pick ?? candidates.length,
    // Identifies the matrix: change a stop or move one, and the cache misses.
    signature: stops.map((s) => `${s.name}@${s.lon},${s.lat}`).join('|'),
  };
}
