import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_PRESETS } from '../web/map/theme-config.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const doc = read('../docs/CARTOGRAPHY.md');
const css = read('../web/app.css');

/** CSS custom properties declared in app.css's :root block. */
function shippedTokens() {
  const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  return [...new Set([...root.matchAll(/--([a-z][a-z0-9-]*)\s*:/g)].map((m) => `--${m[1]}`))].sort();
}

/** The pace-tier rules that encode how fast a road runs. */
function paceClasses() {
  return [...new Set([...css.matchAll(/\.(reach-line|leg)\.(pace-[0-2])/g)]
    .map((m) => `.${m[1]}.${m[2]}`))].sort();
}

/** Every styling key across every preset, minus the human-readable label. */
function themeTokens() {
  const keys = new Set();
  for (const preset of Object.values(THEME_PRESETS)) {
    for (const k of Object.keys(preset)) if (k !== 'name') keys.add(k);
  }
  return [...keys].sort();
}

/** Text under an H2 heading, up to the next H2 or end of file. */
function section(heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `CARTOGRAPHY.md is missing a "## ${heading}" section`);
  const rest = doc.slice(start + 3);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Tokens must be written in backticks in the document, and are matched with the
 * backticks included. Plain substring matching would be wrong: `--dim` is a
 * substring of `--dimmer`, `--road` of `--road-hot`, and `land` of `farmland`,
 * so a bare includes() reports tokens as classified when they are not.
 */
const names = (text, token) => text.includes(`\`${token}\``);

test('every shipped CSS custom property is classified', () => {
  const live = section('Load-bearing') + section('Scenery');
  const missing = shippedTokens().filter((t) => !names(live, t));
  assert.deepEqual(missing, [], `unclassified app.css tokens: ${missing.join(', ')}`);
});

test('every pace-tier class is named as load-bearing', () => {
  const loadBearing = section('Load-bearing');
  const missing = paceClasses().filter((c) => !names(loadBearing, c));
  assert.deepEqual(missing, [], `pace classes missing from Load-bearing: ${missing.join(', ')}`);
});

test('there is at least one pace class to protect', () => {
  assert.ok(paceClasses().length >= 3, 'expected .reach-line.pace-0/1/2 in app.css');
});

test('every theme-config token is classified under Not shipped', () => {
  const notShipped = section('Not shipped');
  const missing = themeTokens().filter((t) => !names(notShipped, t));
  assert.deepEqual(missing, [], `unclassified theme tokens: ${missing.join(', ')}`);
});

test('no shipped token is classified as both load-bearing and scenery', () => {
  const loadBearing = section('Load-bearing');
  const scenery = section('Scenery');
  const both = shippedTokens().filter((t) => names(loadBearing, t) && names(scenery, t));
  assert.deepEqual(both, [], `tokens in both sections: ${both.join(', ')}`);
});
