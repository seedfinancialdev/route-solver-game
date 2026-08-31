// blind-map/blind-gl.js
//
// The map-legibility test harness. One real junction at a time, at a fixed
// zoom, with everything outside a ~300m radius hidden — design-intent.md's
// fog-of-war radius, "The loop". No pan, no zoom: the fiction is that you
// can only ever see this far, so letting a tester zoom out to cheat would
// invalidate the test this harness exists to run.

import { metersToPixels } from './fog-radius.mjs';

const FOG_RADIUS_METERS = 300;
// 15, not 16 — MapLibre's world is 512px-tile-based, one zoom level "ahead"
// of the 256px OSM/Google convention at the same visual scale. See
// fog-radius.mjs's EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 comment.
const FIXED_ZOOM = 15;

const fail = (msg) => {
  const el = document.getElementById('err');
  el.style.display = 'block';
  el.textContent = msg;
  console.error('[blind-map]', msg);
};

const idxEl = document.getElementById('idx');
const totalEl = document.getElementById('total');
const fogEl = document.getElementById('fog');
const nextBtn = document.getElementById('next');

async function main() {
  if (!window.BLIND_MAP_STYLE) { fail('style.js did not load — the map has no style to render.'); return; }
  const res = await fetch('candidates.json');
  if (!res.ok) { fail(`could not load candidates.json (${res.status})`); return; }
  const candidates = await res.json();
  if (!candidates.length) { fail('candidates.json is empty'); return; }

  let i = 0;
  totalEl.textContent = String(candidates.length);

  const map = new maplibregl.Map({
    container: 'map',
    style: window.BLIND_MAP_STYLE,
    center: [candidates[0].lon, candidates[0].lat],
    zoom: FIXED_ZOOM,
    interactive: false,
    // Attribution intentionally omitted: this is a local, unpublished dev
    // test harness, not a published product — not a change in behavior.
    attributionControl: false,
  });

  // Unlike atlas-gl.js, this handler is deliberately NOT narrowed to
  // style/expression/layer/source errors: the harness needs live internet for
  // OpenFreeMap vector tiles and AWS terrain tiles, so a tile-load or network
  // failure is a likely real failure mode here. Staying silent on those would
  // let a tester think a broken map is fine — worse than an over-eager banner.
  map.on('error', (e) => {
    const msg = e && e.error ? e.error.message : String(e);
    fail(`Map error: ${msg}`);
  });

  function showCandidate(index) {
    const c = candidates[index];
    map.jumpTo({ center: [c.lon, c.lat], zoom: FIXED_ZOOM });
    const px = metersToPixels(FOG_RADIUS_METERS, c.lat, FIXED_ZOOM);
    fogEl.style.setProperty('--radius-px', `${px}px`);
    idxEl.textContent = String(index + 1);
  }

  map.on('load', () => showCandidate(i));
  nextBtn.addEventListener('click', () => {
    i = (i + 1) % candidates.length;
    showCandidate(i);
  });
}

main().catch(fail);
