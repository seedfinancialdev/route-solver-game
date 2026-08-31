// blind-map/style.js
//
// The blind-map style — the map-legibility test harness's evidence surface.
//
// Forked from legacy/atlas/style.js and trimmed to exactly what
// design-intent.md's "prove the map reads" gate needs: road class (colour
// AND width, never hue alone), terrain, water, land cover. Every label layer
// is gone deliberately — this map is read by geometry and class, not by
// names, because the game it proves out never shows names at this stage
// either. Deleted relative to the fork: road-labels, place-labels,
// city-labels, city-dots, boundary, run-ends, run-labels,
// route-halo/alt/best — all atlas-specific or label-bearing.
//
// Kept as data in its own file so it can be validated in node without a
// browser — see check-style.mjs.

(function (root) {
  const OFM = 'https://tiles.openfreemap.org';

  const CLASS_COLOUR = [
    'match', ['get', 'class'],
    'motorway', '#e8503a',
    'trunk', '#ef8a3c',
    'primary', '#f0b357',
    'secondary', '#ddc79a',
    'tertiary', '#c4bda6',
    '#b9b39f',
  ];

  const CLASS_WIDTH = [
    'match', ['get', 'class'],
    'motorway', 1.0, 'trunk', 0.82, 'primary', 0.66,
    'secondary', 0.50, 'tertiary', 0.38, 'minor', 0.28,
    0.24,
  ];

  const SURFACE_ADJ = [
    'case',
    ['==', ['get', 'surface'], 'unpaved'], 0.7,
    ['==', ['get', 'expressway'], 1], 1.15,
    1.0,
  ];
  const ROAD_WIDTH = ['*', CLASS_WIDTH, SURFACE_ADJ];

  // Only classes this game's own road graph actually routes on may draw.
  // OSM footway/cycleway/path/steps/pedestrian all collapse to OpenMapTiles'
  // 'path' class in the transportation layer (confirmed against
  // openmaptiles.org/schema — none of them are 'service', so excluding only
  // 'service' left them all rendering). That's not neutral scenery: at a
  // ~300m radius a dense pedestrian/cycle path network visually buries the
  // real junction it sits next to, exactly the failure a real person caught
  // running blind-map/README.md's protocol against a Trondheim riverside
  // candidate. 'minor' and 'residential' are both allowlisted since the live
  // tileset's exact naming for residential/unclassified/living_street-class
  // roads (our graph's own terms) was not pinned to a single value.
  const DRIVABLE = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'residential'];
  const ROAD_FILTER = ['match', ['get', 'class'], DRIVABLE, true, false];

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
    sources: {
      omt: { type: 'vector', url: `${OFM}/planet` },
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium', tileSize: 256, maxzoom: 12,
        attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
      },
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

      { id: 'roads-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ROAD_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#161a21', 'line-opacity': 0.85,
          'line-width': zoomWidth([4, 0.9, 8, 2.8, 13, 10], ROAD_WIDTH, 1.4) } },
      { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ROAD_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CLASS_COLOUR,
          'line-width': zoomWidth([4, 0.9, 8, 2.8, 13, 10], ROAD_WIDTH) } },
    ],
  };

  root.BLIND_MAP_STYLE = style;
  if (typeof module !== 'undefined' && module.exports) module.exports = { style };
}(typeof window !== 'undefined' ? window : globalThis));
