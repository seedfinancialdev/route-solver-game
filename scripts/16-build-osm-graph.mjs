// Orchestrates the OSM road-graph pipeline.
//
//   data/raw/osm/*.osm.pbf        country extracts, downloaded (gitignored)
//        |  scripts/15-filter-roads.py   ~3% of the input survives
//   data/raw/osm-roads/*.osm.pbf  roads only, cached (gitignored)
//        |  scripts/14-road-graph.py
//   data/road-graph/              binary routable graph (gitignored)
//
// The filter step is cached per country, which is what makes this incremental:
// adding a country later costs filtering that one file. The graph itself is
// rebuilt over the whole filtered set every time, because a cross-border edge
// needs both countries' nodes in the same build.
//
// Node IDs in the output are positions in a sorted array, so they shift on
// every rebuild. Nothing may persist them — routes are stored as geography.
// See docs/superpowers/specs/2026-08-22-infrastructure-decisions.md.
//
// Usage: npm run osm:build

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

const PY = '.venv/bin/python';
const RAW = 'data/raw/osm';
const ROADS = 'data/raw/osm-roads';
const OUT = 'data/road-graph';

if (!existsSync(PY)) {
  console.error('missing .venv — create it with:');
  console.error('  python3 -m venv .venv && .venv/bin/pip install osmium numpy');
  process.exit(1);
}
if (!existsSync(RAW)) {
  console.error(`no extracts in ${RAW}/. Download country .osm.pbf files from geofabrik.de first.`);
  process.exit(1);
}
mkdirSync(ROADS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const mb = (p) => (statSync(p).size / 1048576).toFixed(0);
const extracts = readdirSync(RAW).filter((f) => f.endsWith('.osm.pbf')).sort();
if (!extracts.length) {
  console.error(`no .osm.pbf files in ${RAW}/`);
  process.exit(1);
}

console.log(`${extracts.length} extracts\n`);
const filtered = [];
for (const f of extracts) {
  const src = `${RAW}/${f}`;
  const dst = `${ROADS}/${f.replace('-latest.osm.pbf', '-roads.osm.pbf')}`;
  filtered.push(dst);
  if (existsSync(dst)) {
    console.log(`  cached  ${f.padEnd(34)} ${mb(dst).padStart(6)} MB`);
    continue;
  }
  process.stdout.write(`  filter  ${f.padEnd(34)} ${mb(src).padStart(6)} MB -> `);
  execFileSync(PY, ['scripts/15-filter-roads.py', src, dst], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`${mb(dst).padStart(6)} MB`);
}

console.log('\nbuilding graph');
execFileSync(PY, ['scripts/14-road-graph.py', OUT, ...filtered], { stdio: 'inherit' });
