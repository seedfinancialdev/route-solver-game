#!/usr/bin/env node
// Static payload audit. No browser, no new dependencies. Answers: what does a
// player download, what is dead weight, and has any of it grown past budget?

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { classify } from './lib/asset-scan.mjs';

const WEB = new URL('../web/', import.meta.url);
const SOURCE_EXT = new Set(['.js', '.html', '.css']);
const ASSET_EXT = new Set(['.webp', '.json', '.png', '.js', '.css', '.html']);

const config = JSON.parse(readFileSync(new URL('perf-budget.json', WEB), 'utf8'));
const skip = new Set(config.skipDirs);
const ext = (p) => p.slice(p.lastIndexOf('.'));

function walk(dir = WEB, prefix = '', out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue;
      walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, out);
    } else out.push(`${prefix}${entry.name}`);
  }
  return out;
}

const sources = new Map();
const assets = [];
for (const path of walk()) {
  if (path === 'perf-budget.json') continue;
  if (SOURCE_EXT.has(ext(path))) sources.set(path, readFileSync(new URL(path, WEB), 'utf8'));
  if (ASSET_EXT.has(ext(path))) assets.push(path);
}

// Resolve each declared manifest into the asset paths it provides.
const manifests = [];
for (const m of config.manifests) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(new URL(m.file, WEB), 'utf8')); } catch { continue; }
  const dir = m.file.slice(0, m.file.lastIndexOf('/') + 1);
  const provides = m.key
    ? (parsed[m.key] ?? []).map((t) => t[m.pathField])
    // streets/manifest.json is index -> geonameid; files sit beside it.
    : Object.values(parsed).map((gid) => `${dir}${gid}.json`);
  manifests.push({ file: m.file, provides: provides.filter((p) => assets.includes(p)) });
}

const { eager, deferred, orphan } = classify({
  assets, sources, entryPoints: config.entryPoints, manifests,
});

const sizeKB = (p) => statSync(new URL(p, WEB)).size / 1024;
const totalKB = (list) => list.reduce((t, p) => t + sizeKB(p), 0);
const kb = (n) => `${n.toFixed(0)} KB`.padStart(10);

let failed = false;
const fail = (msg) => { failed = true; console.log(`  FAIL  ${msg}`); };

const eagerKB = totalKB(eager);
console.log(`\n=== eager: reachable from ${config.entryPoints.join(', ')} ===`);
for (const p of [...eager].sort((a, b) => sizeKB(b) - sizeKB(a)).slice(0, 10)) {
  console.log(`${kb(sizeKB(p))}  ${p}`);
}
console.log(`${kb(eagerKB)}  TOTAL of ${eager.length} files (budget ${config.budgets.eagerTotalKB} KB)`);

const streets = deferred.filter((p) => p.startsWith('streets/'));
const deferredKB = totalKB(deferred);
console.log('\n=== deferred: requested on demand ===');
console.log(`${kb(deferredKB)}  ${deferred.length} files (budget ${config.budgets.deferredTotalKB} KB)`);
if (streets.length) {
  const largest = streets.reduce((a, b) => (sizeKB(a) > sizeKB(b) ? a : b));
  console.log(`${kb(totalKB(streets))}  ${streets.length} street files, largest ${largest}`);
}

console.log('\n=== orphaned: shipped, reachable from nothing ===');
const known = new Set(config.knownOrphans);
if (!orphan.length) console.log('  none');
for (const p of orphan) console.log(`${kb(sizeKB(p))}  ${p}${known.has(p) ? '  (known)' : ''}`);

console.log('\n=== draw-loop inputs ===');
const data = JSON.parse(readFileSync(new URL('data.json', WEB), 'utf8'));
console.log(`  cities ${data.cities.length}, edges ${data.edges.length}, `
  + `urbanAreas ${data.urbanAreas.length}, towns ${data.towns.length}, `
  + `rivers ${data.rivers.length}, lakes ${data.lakes.length}`);

console.log('\n=== budgets ===');
const check = (actual, budget, label) => {
  if (actual > budget) fail(`${label} ${actual.toFixed(0)} KB over budget ${budget} KB`);
};
check(eagerKB, config.budgets.eagerTotalKB, 'eager payload');
check(deferredKB, config.budgets.deferredTotalKB, 'deferred payload');
check(totalKB(streets), config.budgets.streetTotalKB, 'street data');
for (const p of streets) check(sizeKB(p), config.budgets.largestStreetFileKB, p);
for (const p of orphan) {
  if (!known.has(p)) fail(`${p} (${sizeKB(p).toFixed(0)} KB) is shipped but reachable from nothing`);
}
if (!failed) console.log('  all within budget');

process.exit(failed ? 1 : 0);
