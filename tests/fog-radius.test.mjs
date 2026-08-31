import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metersPerPixel, metersToPixels } from '../blind-map/fog-radius.mjs';

test('at the equator, zoom 0, meters-per-pixel matches the known Web Mercator reference value', () => {
  const mpp = metersPerPixel(0, 0);
  assert.ok(Math.abs(mpp - 156543.03392) < 0.001);
});

test('meters per pixel halves for each zoom level increase, at fixed latitude', () => {
  const z10 = metersPerPixel(45, 10);
  const z11 = metersPerPixel(45, 11);
  assert.ok(Math.abs(z11 - z10 / 2) < 1e-6);
});

test('meters per pixel shrinks moving away from the equator, at fixed zoom', () => {
  const equator = metersPerPixel(0, 12);
  const midLat = metersPerPixel(50, 12);
  assert.ok(midLat < equator);
});

test('metersToPixels grows as zoom increases, for a fixed real-world radius', () => {
  const near = metersToPixels(300, 52, 15);
  const far = metersToPixels(300, 52, 17);
  assert.ok(far > near);
});

test('metersToPixels is the inverse of metersPerPixel by construction', () => {
  const mpp = metersPerPixel(40, 14);
  const px = metersToPixels(300, 40, 14);
  assert.ok(Math.abs(px * mpp - 300) < 1e-6);
});
