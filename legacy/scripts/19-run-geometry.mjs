// Emits the career runs' corridors as GeoJSON for the atlas.
//
// GEOMETRY CAVEAT, and it is visible: the road graph stores no shapes, only
// junction positions, so a corridor comes out as straight lines between
// junctions. At continental zoom that is indistinguishable from the real road.
// Zoomed in it cuts corners, and it will sit visibly off the road the vector
// tiles draw underneath.
//
// Fixing that properly means a geometry sidecar from the graph build —
// delta-encoded and quantised, roughly 170 MB for the continental graph. Worth
// doing when routes need to be inspected close up; not worth it to see whether
// the corridors are in the right places.
//
// Usage: npm run runs:geometry

import { readFileSync, writeFileSync } from 'node:fs';
import { loadGraph, nearestNode, route, corridors, timesFrom, bestOrder } from '../../scripts/lib/road-graph.mjs';

const g = loadGraph('data/road-graph');
const runs = JSON.parse(readFileSync('data/runs.json', 'utf8')).runs;

/** Junction positions along a run of edges, as a lon/lat line. */
function line(edges) {
  const pts = [];
  for (const e of edges) {
    const a = g.a[e];
    pts.push([+g.xy[2 * a].toFixed(5), +g.xy[2 * a + 1].toFixed(5)]);
  }
  const last = g.b[edges[edges.length - 1]];
  pts.push([+g.xy[2 * last].toFixed(5), +g.xy[2 * last + 1].toFixed(5)]);
  return pts;
}

const out = { type: 'FeatureCollection', features: [] };

for (const r of runs) {
  const checkpoints = r.checkpoints || [];
  const stops = [r.from, ...checkpoints, r.to];
  const nodes = stops.map((p) => nearestNode(g, p.lon, p.lat));

  if (!r.ordered && checkpoints.length > 1) {
    // A circuit's route is its best checkpoint order, so that is what to draw.
    const matrix = nodes.map((src) => {
      const d = timesFrom(g, src);
      return nodes.map((dst) => d[dst]);
    });
    const { order } = bestOrder(matrix, stops.length);
    const edges = [];
    for (let i = 1; i < order.length; i++) edges.push(...route(g, nodes[order[i - 1]], nodes[order[i]]).edges);
    out.features.push({
      type: 'Feature',
      properties: { run: r.id, name: r.name, rank: 0, style: r.style },
      geometry: { type: 'LineString', coordinates: line(edges) },
    });
    console.log(`${r.name}: circuit, ${edges.length.toLocaleString()} edges`);
    continue;
  }

  const cs = corridors(g, nodes[0], nodes[nodes.length - 1], { tolerance: 1.20, rounds: 12 });
  cs.forEach((c, i) => {
    out.features.push({
      type: 'Feature',
      properties: {
        run: r.id, name: r.name, rank: i, style: r.style,
        km: Math.round(c.km), minutes: Math.round(c.minutes),
        // rank 0 is the fastest corridor; the rest are the alternatives the
        // player is choosing between, and are drawn back.
        penalty: +(c.minutes / cs[0].minutes - 1).toFixed(3),
      },
      geometry: { type: 'LineString', coordinates: line(c.edges) },
    });
  });
  console.log(`${r.name}: ${cs.length} corridors`);
}

writeFileSync('atlas/run-routes.geojson', JSON.stringify(out));
const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`\n${out.features.length} features, ${kb} KB -> atlas/run-routes.geojson`);
