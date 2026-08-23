// Orchestrates the OSM pipeline.
//
//   data/raw/osm/*.osm.pbf         country extracts, downloaded (gitignored)
//        |  15-filter-roads.py     roads only, per country, cached
//   data/raw/osm-roads/*.osm.pbf
//        |  14-road-graph.py
//   data/road-graph/               binary routable graph (gitignored)
//
//   data/raw/osm/*.osm.pbf
//        |  18-fuel.py             stations, per country, cached
//   data/raw/osm-fuel/*.json  ->   data/fuel.json (merged)
//
// Both per-country stages run in PARALLEL. They are independent, the machine
// has cores, and single-threaded they are the whole runtime — pyosmium calls
// back into Python once per element across ~23 GB of PBF, so this is CPU-bound
// and nothing else. Nothing here touches a network service.
//
// Caching is per country, which is what makes the pipeline incremental: adding
// a country as routes are added costs that one country. The graph itself is
// rebuilt over the whole filtered set, because a cross-border edge needs both
// countries' nodes in one build.
//
// Node IDs in the graph are positions in a sorted array and shift on every
// rebuild. Nothing may persist them — routes are stored as geography. See
// docs/superpowers/specs/2026-08-22-infrastructure-decisions.md.
//
// Usage: npm run osm:build [-- --jobs N]

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

const PY = '.venv/bin/python';
const RAW = 'data/raw/osm';
const ROADS = 'data/raw/osm-roads';
const FUEL = 'data/raw/osm-fuel';
const OUT = 'data/road-graph';

const argv = process.argv.slice(2);
const jobsArg = argv.indexOf('--jobs');
// Leave a couple of cores: these are memory-hungry and the machine still has
// to be usable.
const JOBS = jobsArg >= 0 ? Number(argv[jobsArg + 1]) : Math.max(1, cpus().length - 2);

if (!existsSync(PY)) {
  console.error('missing .venv — python3 -m venv .venv && .venv/bin/pip install osmium numpy');
  process.exit(1);
}
for (const d of [ROADS, FUEL, OUT]) mkdirSync(d, { recursive: true });

const mb = (p) => (statSync(p).size / 1048576).toFixed(0);
const extracts = readdirSync(RAW).filter((f) => f.endsWith('.osm.pbf')).sort();
if (!extracts.length) {
  console.error(`no .osm.pbf files in ${RAW}/`);
  process.exit(1);
}

/** Run a queue of jobs at most JOBS at a time. */
function pool(tasks, label) {
  return new Promise((resolve, reject) => {
    let next = 0, done = 0, failed = null;
    const started = Date.now();
    const launch = () => {
      if (failed) return;
      if (next >= tasks.length) {
        if (done === tasks.length) {
          console.log(`  ${label} done in ${((Date.now() - started) / 60000).toFixed(1)} min\n`);
          resolve();
        }
        return;
      }
      const t = tasks[next++];
      execFile(PY, t.args, { maxBuffer: 1 << 24 }, (err) => {
        if (err && !failed) { failed = err; reject(err); return; }
        done++;
        console.log(`  [${String(done).padStart(2)}/${tasks.length}] ${t.name}`
          + (existsSync(t.out) ? ` -> ${mb(t.out)} MB` : ''));
        launch();
      });
      launch();     // fill the pool
    };
    for (let i = 0; i < Math.min(JOBS, tasks.length); i++) launch();
  });
}

console.log(`${extracts.length} extracts, ${JOBS} parallel jobs\n`);

// ---- roads -----------------------------------------------------------------
const roadTasks = [];
const filtered = [];
for (const f of extracts) {
  const out = `${ROADS}/${f.replace('-latest.osm.pbf', '-roads.osm.pbf')}`;
  filtered.push(out);
  if (existsSync(out)) continue;
  roadTasks.push({ name: f, out, args: ['scripts/15-filter-roads.py', `${RAW}/${f}`, out] });
}
if (roadTasks.length) {
  console.log(`filtering roads (${roadTasks.length} to do, ${extracts.length - roadTasks.length} cached)`);
  await pool(roadTasks, 'roads');
} else console.log('roads: all cached\n');

// ---- fuel ------------------------------------------------------------------
const fuelTasks = [];
const fuelFiles = [];
for (const f of extracts) {
  const out = `${FUEL}/${f.replace('-latest.osm.pbf', '-fuel.json')}`;
  fuelFiles.push(out);
  if (existsSync(out)) continue;
  fuelTasks.push({ name: f, out, args: ['scripts/18-fuel.py', `${RAW}/${f}`, out] });
}
if (fuelTasks.length) {
  console.log(`extracting fuel (${fuelTasks.length} to do, ${extracts.length - fuelTasks.length} cached)`);
  await pool(fuelTasks, 'fuel');
} else console.log('fuel: all cached\n');

// A station on a border shows up in both countries' extracts; ~100 m of
// rounding is tighter than any two real stations.
const seen = new Set();
const stations = [];
for (const f of fuelFiles) {
  for (const s of JSON.parse(readFileSync(f, 'utf8')).stations) {
    const key = `${s[0].toFixed(3)},${s[1].toFixed(3)},${s[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stations.push(s);
  }
}
writeFileSync('data/fuel.json', JSON.stringify({
  note: 'kind: 0 = amenity=fuel, 1 = highway=services',
  sources: extracts,
  stations,
}));
const fuelCount = stations.filter((s) => s[2] === 0).length;
console.log(`merged ${stations.length.toLocaleString()} stations `
  + `(${fuelCount.toLocaleString()} fuel, ${(stations.length - fuelCount).toLocaleString()} services)\n`);

// ---- graph -----------------------------------------------------------------
console.log('building graph');
execFileSync(PY, ['scripts/14-road-graph.py', OUT, ...filtered], { stdio: 'inherit' });
