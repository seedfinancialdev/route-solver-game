/**
 * The atlas style.
 *
 * Kept as data in its own file so it can be validated in node without a
 * browser (see check-style.mjs). A style that fails validation is rejected
 * WHOLE — the map then renders nothing at all, background layer included, with
 * the only symptom a console message. That has to be catchable before it ships.
 *
 * Every road is playable, so this is a road atlas, not a game board with a
 * network drawn on it. The design decisions live here as expressions rather
 * than as drawing code:
 *   - colour states road TYPE (the real OSM class)
 *   - width states type too, refined by the attributes that genuinely diverge
 *     from it (unpaved, expressway) -- the doubling a paper atlas uses
 *   - widths interpolate down with zoom but never reach zero, so nothing that
 *     carries information is ever gated away
 *
 * The measured pace tell is absent, deliberately and temporarily: see the note
 * on CLASS_WIDTH below.
 */
(function (root) {
  const OFM = 'https://tiles.openfreemap.org';

  // Warm hierarchy. Measured against a dark casing, cool hues cannot clear the
  // 3:1 contrast floor, so the blue-motorway conventions are unavailable here.
  const CLASS_COLOUR = [
    'match', ['get', 'class'],
    'motorway', '#e8503a',
    'trunk', '#ef8a3c',
    'primary', '#f0b357',
    'secondary', '#ddc79a',
    'tertiary', '#c4bda6',
    '#b9b39f',
  ];

  // Every road is playable, so there is no separate game network to pick out —
  // the map IS the road network, drawn as an atlas draws one: class in both
  // colour and width, which is the doubling every paper atlas uses.
  //
  // NOTE, and it is a real cost: the measured pace tell is NOT on this map.
  // Pace exists only for the 2,160 curated edges, and the vector tiles carry no
  // maxspeed, so there is nothing honest to weight the rest of the network by.
  // Deriving speed from class would only restate the colour. Restoring the tell
  // for all roads needs tiles built with maxspeed in the schema.
  const CLASS_WIDTH = [
    'match', ['get', 'class'],
    'motorway', 1.0, 'trunk', 0.82, 'primary', 0.66,
    'secondary', 0.50, 'tertiary', 0.38, 'minor', 0.28,
    0.24,
  ];

  // The two attributes the tiles DO carry that genuinely diverge from class: a
  // dual-carriageway expressway drives faster than its class implies, and an
  // unpaved road drives far slower. Everything else in the schema restates
  // class, so weighting by it would be decoration.
  const SURFACE_ADJ = [
    'case',
    ['==', ['get', 'surface'], 'unpaved'], 0.7,
    ['==', ['get', 'expressway'], 1], 1.15,
    1.0,
  ];
  const ROAD_WIDTH = ['*', CLASS_WIDTH, SURFACE_ADJ];

  /**
   * width = f(zoom) * per-feature multiplier (+ optional casing bleed).
   *
   * The multiplier is folded into each interpolate OUTPUT rather than wrapping
   * the interpolate in a `*`. A ["zoom"] expression is only legal as the input
   * to a TOP-LEVEL step/interpolate; nesting it anywhere else fails validation
   * and takes the whole style down with it.
   */
  function zoomWidth(stops, mult = 1, add = 0) {
    const expr = ['interpolate', ['exponential', 1.4], ['zoom']];
    for (let i = 0; i < stops.length; i += 2) {
      let value = mult === 1 ? stops[i + 1] : ['*', stops[i + 1], mult];
      if (add) value = ['+', value, add];
      expr.push(stops[i], value);
    }
    return expr;
  }

  const style = {
    version: 8,
    glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${OFM}/sprites/ofm_f384/ofm`,
    sources: {
      omt: { type: 'vector', url: `${OFM}/planet` },
      dem: {
        // The same dataset scripts/04-terrain.py already downloads, in the
        // format an engine can hillshade live — so relief is sharp at every
        // zoom instead of 195 m/px magnified.
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium', tileSize: 256, maxzoom: 12,
        attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
      },
      cities: { type: 'geojson', data: './cities.geojson' },
      runs: { type: 'geojson', data: './runs.geojson' },
      routes: { type: 'geojson', data: './run-routes.geojson' },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': '#5a714d' } },

      { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        paint: {
          'fill-color': ['match', ['get', 'class'],
            'wood', 'rgba(27,71,44,.60)', 'forest', 'rgba(27,71,44,.60)',
            'grass', 'rgba(104,124,86,.32)', 'farmland', 'rgba(146,142,96,.20)',
            'rgba(120,132,98,.16)'],
        } },

      { id: 'hillshade', type: 'hillshade', source: 'dem',
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#0d1a12',
          'hillshade-highlight-color': '#cfe0bb', 'hillshade-accent-color': '#25301f' } },

      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
        paint: { 'fill-color': '#16394f' } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
        paint: { 'line-color': '#20648f', 'line-width': zoomWidth([4, 0.4, 10, 1.8]) } },

      { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 2],
        paint: { 'line-color': 'rgba(236,242,248,.34)',
          'line-width': zoomWidth([2, 0.6, 8, 1.6]), 'line-dasharray': [3, 2] } },

      // ---- real road network: colour states TYPE --------------------------
      { id: 'roads-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['!=', ['get', 'class'], 'service'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#161a21', 'line-opacity': 0.85,
          'line-width': zoomWidth([4, 0.9, 8, 2.8, 13, 10], ROAD_WIDTH, 1.4) } },
      { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['!=', ['get', 'class'], 'service'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CLASS_COLOUR,
          'line-width': zoomWidth([4, 0.9, 8, 2.8, 13, 10], ROAD_WIDTH) } },

      // ---- names: real collision detection, real along-line placement ------
      { id: 'road-labels', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name',
        minzoom: 9,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'], 'text-size': 11, 'symbol-spacing': 260 },
        paint: { 'text-color': '#f4efe2', 'text-halo-color': 'rgba(8,13,20,.9)',
          'text-halo-width': 1.4 } },

      { id: 'place-labels', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['country', 'state', 'city', 'town', 'village'], true, false],
        layout: {
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
          'text-size': ['match', ['get', 'class'], 'country', 13, 'state', 11, 'city', 12, 'town', 11, 9],
          'text-transform': ['match', ['get', 'class'], 'country', 'uppercase', 'none'],
          'text-letter-spacing': ['match', ['get', 'class'], 'country', 0.12, 0],
          'text-max-width': 8,
        },
        paint: { 'text-color': ['match', ['get', 'class'], 'country', 'rgba(226,234,242,.72)', '#f2f6fa'],
          'text-halo-color': 'rgba(6,11,17,.92)', 'text-halo-width': 1.6 } },

      // ---- the playable nodes ----------------------------------------------
      { id: 'city-dots', type: 'circle', source: 'cities',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 8, 5],
          'circle-color': '#ffffff', 'circle-stroke-color': '#0b0f17', 'circle-stroke-width': 1.4 } },
      // ---- the run being planned -------------------------------------------
      // Sits above the road network, not inside it: this is a route under
      // consideration, not part of the world. The fastest corridor reads
      // solid; the alternatives are the choice, so they stay present but
      // quieter rather than being hidden.
      { id: 'route-halo', type: 'line', source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0b1016', 'line-blur': 1,
          'line-width': zoomWidth([3, 5, 7, 11, 12, 20]),
          'line-opacity': 0.55 } },
      { id: 'route-alt', type: 'line', source: 'routes',
        filter: ['>', ['get', 'rank'], 0],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#8fb7cf', 'line-dasharray': [2.5, 1.8],
          'line-width': zoomWidth([3, 1.4, 7, 2.6, 12, 4]),
          'line-opacity': 0.75 } },
      { id: 'route-best', type: 'line', source: 'routes',
        filter: ['==', ['get', 'rank'], 0],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff',
          'line-width': zoomWidth([3, 2.2, 7, 4, 12, 6.5]),
          'line-opacity': 0.92 } },

      // ---- career run endpoints -------------------------------------------
      { id: 'run-ends', type: 'circle', source: 'runs',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 9],
          'circle-color': ['match', ['get', 'role'], 'start', '#4ade80', '#f43f5e'],
          'circle-stroke-color': '#0b0f17', 'circle-stroke-width': 2 } },
      { id: 'run-labels', type: 'symbol', source: 'runs',
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'],
          'text-size': 13, 'text-offset': [0, -1.5], 'text-anchor': 'bottom' },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(6,11,17,.95)',
          'text-halo-width': 2.2 } },

      { id: 'city-labels', type: 'symbol', source: 'cities', minzoom: 4,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 9, 14],
          'text-offset': [0.7, 0], 'text-anchor': 'left' },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(6,11,17,.95)',
          'text-halo-width': 1.8 } },
    ],
  };

  root.ATLAS_STYLE = style;
  if (typeof module !== 'undefined' && module.exports) module.exports = { style };
}(typeof window !== 'undefined' ? window : globalThis));
