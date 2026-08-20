#!/usr/bin/env node
// Cheap consistency check over the pipeline's artefacts. Rebuilds nothing —
// answers "is what is on disk self-consistent?" fast enough to run before every
// commit that touches data/.

import { readFileSync, statSync } from 'node:fs';
import {
  PIPELINE, stalenessCheck, manifestAgreement, puzzleIndexCheck,
} from './lib/dag.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

let failed = false;
const fail = (msg) => { failed = true; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

// --- staleness ---------------------------------------------------------------
const mtimes = new Map();
for (const stage of PIPELINE) {
  for (const p of [...stage.inputs, ...stage.outputs]) {
    if (mtimes.has(p)) continue;
    try { mtimes.set(p, statSync(new URL(p, ROOT)).mtimeMs); } catch { /* absent */ }
  }
}

console.log('\n=== staleness ===');
const stale = stalenessCheck(mtimes);
if (!stale.length) ok('every artefact is newer than its inputs');
for (const s of stale) fail(`${s.output} is older than ${s.input} — rebuild it`);

// --- puzzle indices ----------------------------------------------------------
console.log('\n=== puzzles vs graph ===');
let graph, pack;
try {
  graph = read('data/graph.json');
  pack = read('data/puzzles.json');
} catch (e) {
  console.error(`data-doctor: cannot read data/graph.json or data/puzzles.json: ${e.message}`);
  process.exit(2);
}
const badIndices = puzzleIndexCheck(pack.puzzles, graph.cities.length);
if (badIndices.length) {
  fail(`${badIndices.length} city indices referenced by puzzles are not in the graph `
    + `(${badIndices.slice(0, 5).join(', ')}${badIndices.length > 5 ? ', …' : ''}) `
    + '— reselect with npm run data:puzzles');
} else ok(`${pack.puzzles.length} puzzles reference only cities the graph has`);

// --- street manifest ---------------------------------------------------------
console.log('\n=== street manifest vs graph ===');
try {
  const { checked, agree, disagree } = manifestAgreement(
    read('web/streets/manifest.json'), graph.cities,
  );
  if (disagree.length) {
    fail(`${disagree.length} of ${checked} manifest entries point at a different city `
      + 'than the graph has at that index — the game draws the wrong city\'s streets '
      + '(web/app.js:286 takes position from the graph, :291 takes geometry from here). '
      + 'Rebuild with npm run data:streets');
    for (const d of disagree.slice(0, 5)) {
      const name = graph.cities[d.index]?.name ?? '(no such city)';
      console.log(`          index ${d.index}: manifest ${d.manifestGid} vs graph ${name} ${d.graphGid}`);
    }
  } else ok(`all ${agree} manifest entries agree with the graph`);
  const missing = graph.cities.length - checked;
  if (missing > 0) {
    console.log(`  warn  ${missing} cities have no street data (manifest covers ${checked} of ${graph.cities.length})`);
  }
} catch {
  console.log('  warn  no web/streets/manifest.json — street detail not built');
}

// --- output ownership --------------------------------------------------------
console.log('\n=== output ownership ===');
const owners = new Map();
for (const stage of PIPELINE) {
  for (const out of stage.outputs) {
    if (!owners.has(out)) owners.set(out, []);
    owners.get(out).push(stage.script);
  }
}
let contested = false;
for (const [out, scripts] of owners) {
  if (scripts.length > 1) {
    contested = true;
    console.log(`  warn  ${out} is written in full by ${scripts.join(' and ')} — whichever runs last wins`);
  }
}
if (!contested) ok('every output has exactly one producer');

process.exit(failed ? 1 : 0);
