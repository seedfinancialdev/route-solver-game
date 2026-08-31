// blind-map/check-style.mjs
//
// Validates the blind-map style in node, before a browser ever sees it.
// Forked from legacy/atlas/check-style.mjs — same failure mode applies here:
// a style that fails validation is rejected WHOLE, and the only symptom is a
// console message.
//
// The original's route-specific "pace tell" check is dropped — this style
// has no routes source and no pace-tiered line-width arrays to check the
// ordering of.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('./style.js', import.meta.url), 'utf8'), sandbox);
const style = sandbox.window.BLIND_MAP_STYLE;
if (!style) { console.error('style.js did not set window.BLIND_MAP_STYLE'); process.exit(1); }

const problems = [];
const ZOOM_HOSTS = new Set(['interpolate', 'interpolate-hcl', 'interpolate-lab', 'step']);

const isExpr = (v) => Array.isArray(v) && typeof v[0] === 'string';
const isZoom = (v) => Array.isArray(v) && v.length === 1 && v[0] === 'zoom';

function findZoom(node, path, where) {
  if (isZoom(node)) { problems.push(`${where}: ["zoom"] nested at ${path} — legal only as the input to a TOP-LEVEL step/interpolate`); return; }
  if (!Array.isArray(node)) return;
  node.forEach((child, i) => findZoom(child, `${path}[${i}]`, where));
}

function checkProperty(value, where) {
  if (!isExpr(value)) { findZoom(value, 'value', where); return; }
  if (ZOOM_HOSTS.has(value[0])) {
    const inputIndex = value[0] === 'step' ? 1 : 2;
    value.forEach((child, i) => {
      if (i === 0) return;
      if (i === inputIndex && isZoom(child)) return;
      findZoom(child, `[${i}]`, where);
    });
    return;
  }
  findZoom(value, 'value', where);
}

const ids = new Set();
for (const layer of style.layers) {
  if (ids.has(layer.id)) problems.push(`duplicate layer id: ${layer.id}`);
  ids.add(layer.id);

  if (layer.source && !style.sources[layer.source]) {
    problems.push(`${layer.id}: references missing source "${layer.source}"`);
  }
  if (layer.source && style.sources[layer.source]?.type === 'vector' && !layer['source-layer']
      && layer.type !== 'background') {
    problems.push(`${layer.id}: vector source needs a source-layer`);
  }
  for (const group of ['paint', 'layout']) {
    for (const [prop, value] of Object.entries(layer[group] || {})) {
      checkProperty(value, `${layer.id}.${group}.${prop}`);
    }
  }
  if (layer.filter) findZoom(layer.filter, 'filter', `${layer.id}.filter`);
}

if (problems.length) {
  console.error(`style INVALID — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`style OK — ${style.layers.length} layers, ${Object.keys(style.sources).length} sources`);
