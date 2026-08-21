import test from 'node:test';
import assert from 'node:assert/strict';
import { roadWidthsFor } from '../web/map/cartography-layer.js';

// Binding constraint: tier 2 (motorway) is the FASTEST stretch, tier 0
// (primary) the slowest, and fastest draws heaviest — scripts/05-bundle.mjs:44.
// So wherever a band actually draws a bucket, its width must not be thinner
// than a slower bucket's width, or the map lies about which road is faster.
//
// Widths and gates live in web/map/cartography-layer.js's roadWidthsFor
// (factored out of render() so this is importable without a canvas). Trunks
// draw when zoomKm <= 1800, primaries when zoomKm <= 900, motorways always —
// cartography-layer.js:190-228.

/** Assert mwWidth >= trWidth >= prWidth, but only over the buckets this zoom actually draws. */
function assertOrdered(zoomKm) {
  const { mwWidth, trWidth, prWidth, drawPrimaries, drawTrunks } = roadWidthsFor(zoomKm);
  if (drawTrunks) {
    assert.ok(
      mwWidth >= trWidth,
      `zoomKm=${zoomKm}: motorway width ${mwWidth} is thinner than drawn trunk width ${trWidth}`,
    );
  }
  if (drawPrimaries) {
    // Primaries only ever draw alongside trunks (drawPrimaries implies
    // drawTrunks, since 900 <= 1800), but check directly against whichever
    // of the two faster buckets is actually on screen.
    if (drawTrunks) {
      assert.ok(
        trWidth >= prWidth,
        `zoomKm=${zoomKm}: trunk width ${trWidth} is thinner than drawn primary width ${prWidth}`,
      );
    } else {
      assert.ok(
        mwWidth >= prWidth,
        `zoomKm=${zoomKm}: motorway width ${mwWidth} is thinner than drawn primary width ${prWidth}`,
      );
    }
  }
}

test('each named zoom band keeps mwWidth >= trWidth >= prWidth over its drawn buckets', () => {
  // One representative zoomKm from each band the width/gate logic actually
  // distinguishes (breakpoints at 400, 900, 1000, 1800, 2000).
  const bands = [
    { zoomKm: 400, label: '<= 400' },
    { zoomKm: 700, label: '400-900' },
    { zoomKm: 950, label: '900-1000' },
    { zoomKm: 1400, label: '1000-1800' },
    { zoomKm: 1900, label: '1800-2000' },
    { zoomKm: 2500, label: '> 2000' },
  ];
  for (const { zoomKm, label } of bands) {
    assertOrdered(zoomKm);
    // Also pin down which buckets this band draws, so a future gate change
    // shows up here rather than silently changing what gets checked.
    const { drawPrimaries, drawTrunks } = roadWidthsFor(zoomKm);
    assert.equal(drawPrimaries, zoomKm <= 900, `${label}: drawPrimaries gate moved`);
    assert.equal(drawTrunks, zoomKm <= 1800, `${label}: drawTrunks gate moved`);
  }
});

test('the two bands with the widest gap between motorway and primary width are still ordered correctly', () => {
  // <= 400 is the "everything drawn, biggest numbers" band; 400-900 is the
  // steady-state band. These are the two bands where all three buckets are
  // actually on screen at once, so they're the only place a genuinely
  // inverted ordering could be visible today.
  assert.deepEqual(roadWidthsFor(300), { mwWidth: 4.2, trWidth: 2.8, prWidth: 1.6, drawPrimaries: true, drawTrunks: true });
  assert.deepEqual(roadWidthsFor(600), { mwWidth: 3.2, trWidth: 2.2, prWidth: 1.4, drawPrimaries: true, drawTrunks: true });
});

test('a dense sweep across the zoom range never inverts the ordering over drawn buckets', () => {
  for (let zoomKm = 50; zoomKm <= 3000; zoomKm += 25) assertOrdered(zoomKm);
});
