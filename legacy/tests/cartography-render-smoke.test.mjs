import test from 'node:test';
import assert from 'node:assert/strict';
import { CartographyLayer, PACE_ALPHA } from '../web/map/cartography-layer.js';
import { THEME_PRESETS } from '../web/map/theme-config.js';

// The one thing `npm test` could not previously catch: render() reaching into
// bucketRoadRuns' result with the wrong key. `drawShapeBatch` reads
// `shapeList.length` immediately, so a renamed or mistyped bucket is a
// TypeError on the first frame — invisible to every pure unit test, and
// visible to a player as a blank map.
//
// The stub below only RECORDS; every value asserted on is one the renderer
// chose. That is the difference between testing the renderer and testing a mock.

/** Records the ctx state at each stroke, which is what the road passes actually set. */
function recordingContext() {
  const strokes = [];
  const ctx = {
    strokeStyle: null, fillStyle: null, lineWidth: 0, globalAlpha: 1,
    lineCap: '', lineJoin: '', globalCompositeOperation: 'source-over',
    save() {}, restore() {}, setTransform() {}, beginPath() {},
    moveTo() {}, lineTo() {}, fill() {}, closePath() {},
    stroke() {
      strokes.push({
        color: ctx.strokeStyle,
        alpha: ctx.globalAlpha,
        width: ctx.lineWidth,
      });
    },
  };
  return { ctx, strokes };
}

/** One road, five points, deliberately spanning all three pace tiers. */
function oneMixedRoad() {
  const shape = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const pace = [2, 2, 1, 0, 0];
  return { adj: [[{ to: 1, shape, pace }], [{ to: 0, shape, pace }]] };
}

function renderRoadsOnly(zoomKm, theme) {
  const layer = new CartographyLayer();
  layer.showCoastlines = false;
  layer.showWater = false;
  layer.showFarmland = false;
  layer.showForest = false;
  layer.showShields = false;
  layer.showRoads = true;

  const camera = {
    viewportWidth: 1000, viewportHeight: 800,
    current: { x: 0, y: 0, w: zoomKm, h: zoomKm * 0.8 },
  };
  const { ctx, strokes } = recordingContext();

  const priorWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    layer.render(ctx, camera, { ...theme, nightFactor: 0 }, oneMixedRoad());
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
  return strokes;
}

test('render draws the road network without throwing on a bucket key', () => {
  const strokes = renderRoadsOnly(600, THEME_PRESETS.satelliteTopo);
  assert.ok(strokes.length > 0, 'nothing was stroked — the road network did not draw');
});

test('every road surface stroke uses the theme road hue, so hue states nothing about pace', () => {
  const theme = THEME_PRESETS.satelliteTopo;
  const surface = renderRoadsOnly(600, theme).filter((s) => s.color !== theme.roadCasing);

  assert.ok(surface.length >= 3, `expected all three tiers to draw, saw ${surface.length} surface strokes`);
  for (const s of surface) {
    assert.equal(s.color, theme.road, `a road surface drew ${s.color}, not the theme's single ${theme.road}`);
  }
  assert.equal(new Set(surface.map((s) => s.color)).size, 1, 'the road network drew in more than one hue');
});

test('the surface strokes carry pace in width and opacity, ordered slowest-first', () => {
  const theme = THEME_PRESETS.satelliteTopo;
  const surface = renderRoadsOnly(600, theme).filter((s) => s.color !== theme.roadCasing);

  assert.deepEqual(
    surface.map((s) => s.alpha),
    [PACE_ALPHA.slow, PACE_ALPHA.ordinary, PACE_ALPHA.fast],
    'the pace tiers did not draw slowest-first at their pinned opacities',
  );
  for (let i = 0; i < surface.length - 1; i++) {
    assert.ok(
      surface[i + 1].width >= surface[i].width,
      `pass ${i + 1} is thinner than the slower pass beneath it`,
    );
  }
});

test('globalAlpha is left clean for whatever draws next', () => {
  // The road passes set globalAlpha per tier. Leaving it set would silently
  // fade the shields, labels and route line drawn after them.
  const layer = new CartographyLayer();
  layer.showCoastlines = false; layer.showWater = false; layer.showFarmland = false;
  layer.showForest = false; layer.showShields = false;

  const camera = { viewportWidth: 1000, viewportHeight: 800, current: { x: 0, y: 0, w: 600, h: 480 } };
  const { ctx } = recordingContext();
  const priorWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    layer.render(ctx, camera, { ...THEME_PRESETS.satelliteTopo, nightFactor: 0 }, oneMixedRoad());
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
  assert.equal(ctx.globalAlpha, 1, `globalAlpha left at ${ctx.globalAlpha} after rendering roads`);
});
