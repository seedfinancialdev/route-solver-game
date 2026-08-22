import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PRESETS } from '../web/map/theme-config.js';
import { PACE_ALPHA, roadWidthsFor, roadDrawPlan } from '../web/map/cartography-layer.js';

// Hue does not encode pace.
//
// The shipped SVG renderer draws all three pace tiers in ONE colour
// (`--road`, web/app.css:24 — "a road you can take") and carries pace purely
// in stroke width and opacity (web/app.css:228-230). The canvas used to give
// each tier its own hue — red/amber/slate under the names roadMotorway,
// roadTrunk, roadPrimary — which meant three things at once:
//
//   1. `--road` red meant "a road you can take" in one renderer and "the
//      fastest tier" in the other, for the same game;
//   2. it broke docs/CARTOGRAPHY.md's "never hue alone" rule by making hue the
//      loudest tier signal, when width is meant to be the arbiter;
//   3. it spent the class vocabulary (motorway/trunk/primary) on pace data,
//      so a slow mountain stretch of a real motorway drew as a "primary".
//
// Hue is now unclaimed, held for real OSM road class. These tests stop pace
// creeping back into it.

const PRESETS = Object.entries(THEME_PRESETS);

test('every theme preset defines exactly one road hue', () => {
  assert.ok(PRESETS.length > 0, 'no presets found');
  for (const [name, preset] of PRESETS) {
    assert.equal(typeof preset.road, 'string', `${name}: missing a single \`road\` colour`);
    assert.match(preset.road, /^#[0-9a-f]{6}$/i, `${name}: \`road\` is not a hex colour`);
  }
});

test('no preset carries a per-pace-tier road hue', () => {
  // The exact tokens the canvas used to colour tiers with. Their return would
  // reintroduce the renderer disagreement described above.
  const banned = ['roadMotorway', 'roadTrunk', 'roadPrimary'];
  for (const [name, preset] of PRESETS) {
    for (const token of banned) {
      assert.ok(
        !(token in preset),
        `${name}: \`${token}\` is back — hue must not encode pace. `
        + 'These names belong to real road class, not to a pace tier.',
      );
    }
  }
});

test('pace opacity is ordered fastest-brightest, and never inverted', () => {
  // docs/CARTOGRAPHY.md: "Opacity carries the same ordering and must not be
  // inverted against width — the two channels have to agree or the tell
  // becomes ambiguous."
  assert.ok(
    PACE_ALPHA.fast > PACE_ALPHA.ordinary,
    `fast alpha ${PACE_ALPHA.fast} is not brighter than ordinary ${PACE_ALPHA.ordinary}`,
  );
  assert.ok(
    PACE_ALPHA.ordinary > PACE_ALPHA.slow,
    `ordinary alpha ${PACE_ALPHA.ordinary} is not brighter than slow ${PACE_ALPHA.slow}`,
  );
  for (const [tier, a] of Object.entries(PACE_ALPHA)) {
    assert.ok(a > 0 && a <= 1, `${tier} alpha ${a} is outside (0, 1]`);
  }
});

test('opacity ordering agrees with width ordering in every band that draws more than one bucket', () => {
  // Width and opacity are two channels carrying one variable. If a band draws
  // a slower bucket both heavier AND brighter than a faster one, the tell is
  // ambiguous. Checked over the buckets each band actually draws, the same way
  // tests/road-width-ordering.test.mjs scopes its own check.
  for (let zoomKm = 50; zoomKm <= 3000; zoomKm += 25) {
    const { mwWidth, trWidth, prWidth, drawPrimaries, drawTrunks } = roadWidthsFor(zoomKm);
    const drawn = [{ w: mwWidth, a: PACE_ALPHA.fast, name: 'fast' }];
    if (drawTrunks) drawn.push({ w: trWidth, a: PACE_ALPHA.ordinary, name: 'ordinary' });
    if (drawPrimaries) drawn.push({ w: prWidth, a: PACE_ALPHA.slow, name: 'slow' });

    for (let i = 0; i < drawn.length - 1; i++) {
      const faster = drawn[i];
      const slower = drawn[i + 1];
      assert.ok(
        faster.w >= slower.w && faster.a >= slower.a,
        `zoomKm=${zoomKm}: ${faster.name} (w=${faster.w}, a=${faster.a}) does not dominate `
        + `${slower.name} (w=${slower.w}, a=${slower.a}) on both channels`,
      );
    }
  }
});

// The theme holding one hue is not enough on its own: the renderer used to
// pick a colour per bucket with `theme.roadPrimary || '#4b5563'` fallbacks, so
// removing the tokens alone would leave it drawing three hardcoded hues. These
// check what the renderer actually asks the canvas for. roadDrawPlan is
// extracted from render() for the same reason roadWidthsFor was — so the
// contract is checkable in Node without a canvas.

test('every road pass in a band draws in the theme road hue, and no other', () => {
  for (const [name, preset] of PRESETS) {
    for (const zoomKm of [200, 600, 950, 1400, 1900, 2500]) {
      const plan = roadDrawPlan(zoomKm, preset);
      assert.ok(plan.length > 0, `${name} @ ${zoomKm}km: nothing drawn`);
      for (const pass of plan) {
        assert.equal(
          pass.color, preset.road,
          `${name} @ ${zoomKm}km: the ${pass.tier} pass draws ${pass.color}, not the theme's ${preset.road}`,
        );
      }
    }
  }
});

test('the draw plan honours the zoom gates and stays ordered on both channels', () => {
  const theme = THEME_PRESETS.satelliteTopo;
  for (let zoomKm = 50; zoomKm <= 3000; zoomKm += 25) {
    const plan = roadDrawPlan(zoomKm, theme);
    const tiers = plan.map((p) => p.tier);
    // Slowest first so the fastest lands on top — the fast network must never
    // be buried under the slow one at the zoom where corridors get chosen.
    assert.deepEqual(tiers, [...tiers].sort((a, b) => {
      const rank = { slow: 0, ordinary: 1, fast: 2 };
      return rank[a] - rank[b];
    }), `zoomKm=${zoomKm}: passes are out of order (${tiers.join(' -> ')})`);

    assert.ok(tiers.includes('fast'), `zoomKm=${zoomKm}: the fastest network stopped drawing`);
    assert.equal(tiers.includes('ordinary'), zoomKm <= 1800, `zoomKm=${zoomKm}: trunk gate moved`);
    assert.equal(tiers.includes('slow'), zoomKm <= 900, `zoomKm=${zoomKm}: primary gate moved`);

    for (let i = 0; i < plan.length - 1; i++) {
      const slower = plan[i];
      const faster = plan[i + 1];
      assert.ok(
        faster.width >= slower.width && faster.alpha >= slower.alpha,
        `zoomKm=${zoomKm}: ${faster.tier} does not dominate ${slower.tier} on both channels`,
      );
    }
  }
});

test('the pace alphas are pinned, so a retune is a deliberate edit', () => {
  // Deliberately the shipped SVG's own values (web/app.css:228-230), so the
  // two renderers state the pace tell at the same strength.
  assert.deepEqual(PACE_ALPHA, { fast: 0.95, ordinary: 0.74, slow: 0.56 });
});
