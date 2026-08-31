/**
 * SPIKE: the same map, on a real map engine.
 *
 * What stops being our problem here — road class straight off the OSM vector
 * tiles, live hillshade off the DEM the pipeline already downloads, the whole
 * real road network, and real along-line label placement with collision.
 *
 * What stays ours is the part that is actually the game: the curated
 * 2,160-edge network and its pace tell, carried as GeoJSON and styled by
 * weight. The style itself lives in style.js so it can be validated in node
 * (check-style.mjs) before a browser ever sees it.
 */

const fail = (msg) => {
  const el = document.getElementById('err');
  el.style.display = 'block';
  el.textContent = msg;
  console.error('[atlas-gl]', msg);
};

if (!window.ATLAS_STYLE) {
  fail('style.js did not load — the map has no style to render.');
} else {
  const map = new maplibregl.Map({
    container: 'map',
    style: window.ATLAS_STYLE,
    center: [9.5, 48.5],        // wide enough to hold a whole career run
    zoom: 4.2,
    maxZoom: 15,
    hash: true,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

  // A style error rejects the WHOLE style and paints nothing. Say so on screen
  // rather than only in a console nobody has open.
  map.on('error', (e) => {
    const msg = e && e.error ? e.error.message : String(e);
    if (/style|expression|layer|source/i.test(msg)) fail(`Style error: ${msg}`);
    else console.warn('[atlas-gl]', msg);
  });

  // ---- HUD: viewport width in km, which the old studio never showed --------
  const kmEl = document.getElementById('km');
  const fpsEl = document.getElementById('fps');
  const readout = () => {
    const b = map.getBounds();
    const midLat = (b.getNorth() + b.getSouth()) / 2;
    const km = Math.cos((midLat * Math.PI) / 180) * 111.32 * (b.getEast() - b.getWest());
    kmEl.textContent = `${Math.round(Math.abs(km))} km`;
  };
  map.on('move', readout);
  map.on('load', readout);

  let frames = 0, t0 = performance.now();
  (function tick() {
    frames++;
    const now = performance.now();
    if (now - t0 > 500) { fpsEl.textContent = Math.round((frames * 1000) / (now - t0)); frames = 0; t0 = now; }
    requestAnimationFrame(tick);
  }());

  // ---- layer toggles ------------------------------------------------------
  const GROUPS = {
    't-hill': ['hillshade'],
    't-osm': ['roads-casing', 'roads', 'road-labels'],
    't-routes': ['route-halo', 'route-alt', 'route-best'],
    't-labels': ['place-labels', 'city-labels'],
  };
  map.on('load', () => {
    for (const [id, layers] of Object.entries(GROUPS)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('change', () => {
        for (const l of layers) {
          if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', el.checked ? 'visible' : 'none');
        }
      });
    }
  });
}
