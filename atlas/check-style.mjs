// Validates the atlas style in node, before a browser ever sees it.
//
// Exists because a style that fails validation is rejected WHOLE: the map
// renders nothing, background included, and the only symptom is a console
// message. That failure mode reached the human twice; it should not reach them
// a third time.
//
// The headline rule is the one that broke it: a ["zoom"] expression is legal
// ONLY as the input to a top-level step/interpolate. Wrapping such an
// interpolate in a `*` to apply a per-feature multiplier — the obvious way to
// write "width scales with zoom AND with road class" — is invalid, and the
// correct form folds the multiplier into each interpolate output instead.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// style.js is a plain browser script, and this package is "type": "module", so
// require() would load it as ESM and find no exports. Run it in a sandbox with
// a stub window instead, which is also closer to how the browser loads it.
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('./style.js', import.meta.url), 'utf8'), sandbox);
const style = sandbox.window.ATLAS_STYLE;
if (!style) { console.error('style.js did not set window.ATLAS_STYLE'); process.exit(1); }

const problems = [];
const ZOOM_HOSTS = new Set(['interpolate', 'interpolate-hcl', 'interpolate-lab', 'step']);

const isExpr = (v) => Array.isArray(v) && typeof v[0] === 'string';
const isZoom = (v) => Array.isArray(v) && v.length === 1 && v[0] === 'zoom';

/** Flag ["zoom"] anywhere inside this subtree. */
function findZoom(node, path, where) {
  if (isZoom(node)) { problems.push(`${where}: ["zoom"] nested at ${path} — legal only as the input to a TOP-LEVEL step/interpolate`); return; }
  if (!Array.isArray(node)) return;
  node.forEach((child, i) => findZoom(child, `${path}[${i}]`, where));
}

/** A property value: zoom may appear only as the top-level interpolate/step input. */
function checkProperty(value, where) {
  if (!isExpr(value)) { findZoom(value, 'value', where); return; }
  if (ZOOM_HOSTS.has(value[0])) {
    const inputIndex = value[0] === 'step' ? 1 : 2;
    value.forEach((child, i) => {
      if (i === 0) return;
      if (i === inputIndex && isZoom(child)) return;      // the one legal place
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

// The pace tell must stay ordered on BOTH channels, at every zoom stop.
function paceMap(expr) {
  // ['match', input, k1, v1, k2, v2, ..., default] — the slowest tier is
  // usually carried by the DEFAULT rather than an explicit case, so reading
  // only the key/value pairs leaves it undefined.
  const out = {};
  const hasDefault = (expr.length - 2) % 2 === 1;
  const end = hasDefault ? expr.length - 1 : expr.length;
  for (let i = 2; i + 1 < end; i += 2) out[expr[i]] = expr[i + 1];
  const fallback = hasDefault ? expr[expr.length - 1] : undefined;
  return (tier) => (tier in out ? out[tier] : fallback);
}
for (const layer of style.layers) {
  const w = layer.paint?.['line-width'];
  if (!Array.isArray(w) || layer.source !== 'route') continue;
  for (let i = 3; i < w.length; i += 2) {
    const value = w[i + 1];
    if (!Array.isArray(value) || value[0] !== '*') continue;
    const at = paceMap(value[2]);
    const [fast, ordinary, slow] = [at(2), at(1), at(0)];
    if (![fast, ordinary, slow].every((v) => typeof v === 'number')) {
      problems.push(`${layer.id}: pace widths unreadable at zoom ${w[i]}`);
    } else if (!(fast >= ordinary && ordinary >= slow)) {
      problems.push(`${layer.id}: pace widths out of order at zoom ${w[i]} — fast must not be thinner than slow`);
    }
  }
}

if (problems.length) {
  console.error(`style INVALID — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`style OK — ${style.layers.length} layers, ${Object.keys(style.sources).length} sources`);
