// The build pipeline as data, plus the consistency rules that ride on it.
// Pure — no I/O, no logging. Derived from the actual readFileSync/writeFileSync
// sites in scripts/, not from the npm script names, which were wrong (see the
// 04-terrain note below).

export const PIPELINE = [
  { script: 'scripts/00-cities.mjs', inputs: ['data/raw/cities15000.txt'], outputs: ['data/cities.json'], needs: [] },
  { script: 'scripts/01-graph.mjs', inputs: ['data/cities.json'], outputs: ['data/graph.json'], needs: ['OSRM'] },
  { script: 'scripts/02-puzzles.mjs', inputs: ['data/graph.json'], outputs: ['data/puzzles.json'], needs: [] },
  { script: 'scripts/03-map.mjs', inputs: ['data/graph.json'], outputs: ['data/map.json'], needs: [] },
  { script: 'scripts/06-road-names.mjs', inputs: ['data/graph.json'], outputs: ['data/road-names.json'], needs: ['OSRM'] },
  { script: 'scripts/07-streets.mjs', inputs: ['data/graph.json'], outputs: ['web/streets/manifest.json'], needs: ['Overpass'] },
  {
    script: 'scripts/05-bundle.mjs',
    inputs: ['data/graph.json', 'data/map.json', 'data/puzzles.json', 'data/road-names.json'],
    outputs: ['web/data.json'],
    needs: [],
  },
  // Everything below consumes web/data.json, which is why 05-bundle must run
  // first. package.json's data:map had 04-terrain second and 05-bundle third,
  // so 04-terrain read the previous run's bundle.
  {
    script: 'scripts/04-terrain.py',
    inputs: ['data/map.json', 'web/data.json'],
    outputs: ['web/terrain.webp', 'web/terrain-detail.webp', 'web/terrain-tiles.json'],
    needs: [],
  },
  {
    script: 'scripts/10-water-raster.py',
    inputs: ['data/map.json', 'web/data.json'],
    outputs: ['web/water.webp', 'web/water-detail.webp'],
    needs: [],
  },
  {
    script: 'scripts/11-urban-satellite-raster.py',
    inputs: ['data/map.json', 'web/data.json'],
    outputs: ['web/urban-day.webp', 'web/urban-night.webp'],
    needs: [],
  },
  // Both write web/cartography.json in full and neither reads it back, so
  // whichever runs last discards the other's output. Recorded, not resolved.
  { script: 'scripts/08-cartography.mjs', inputs: ['web/data.json'], outputs: ['web/cartography.json'], needs: [] },
  { script: 'scripts/09-real-osm-forests.mjs', inputs: ['web/data.json'], outputs: ['web/cartography.json'], needs: [] },
];

/**
 * Outputs older than something they were built from. Deduped on the
 * (output, input) pair — two pipeline stages can legitimately declare the
 * same output+input (e.g. web/cartography.json's two producers, both fed by
 * web/data.json), but the staleness report should say so once, not once per
 * stage that happens to share the pair.
 */
export function stalenessCheck(mtimes) {
  const stale = [];
  const seen = new Set();
  for (const stage of PIPELINE) {
    for (const output of stage.outputs) {
      const outAt = mtimes.get(output);
      if (outAt === undefined) continue;
      for (const input of stage.inputs) {
        const inAt = mtimes.get(input);
        if (inAt === undefined) continue;
        if (outAt < inAt) {
          const key = `${output}::${input}`;
          if (seen.has(key)) continue;
          seen.add(key);
          stale.push({ output, input });
        }
      }
    }
  }
  return stale;
}

/**
 * web/streets/manifest.json maps city index -> geonameid. Indices are
 * positional, so growing the roster reorders them and silently repoints every
 * entry. web/app.js:286 takes the city's position from the current graph and
 * web/app.js:291 takes its street geometry from this manifest, so a
 * disagreement draws one city's streets at another city's location.
 */
export function manifestAgreement(manifest, cities) {
  let agree = 0;
  const disagree = [];
  const entries = Object.entries(manifest);
  for (const [indexStr, gid] of entries) {
    const index = Number(indexStr);
    const city = cities[index];
    const graphGid = city ? String(city.geonameid) : 'missing';
    if (graphGid === String(gid)) agree++;
    else disagree.push({ index, manifestGid: String(gid), graphGid });
  }
  return { checked: entries.length, agree, disagree };
}

/** City indices a puzzle set references that the graph does not have. */
export function puzzleIndexCheck(puzzles, cityCount) {
  const bad = new Set();
  for (const p of puzzles) {
    if (!(p.a >= 0 && p.a < cityCount)) bad.add(p.a);
    if (!(p.b >= 0 && p.b < cityCount)) bad.add(p.b);
  }
  return [...bad].sort((x, y) => x - y);
}
