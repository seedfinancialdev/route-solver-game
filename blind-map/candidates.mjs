//
// Picks a small, deterministic set of real junctions to show a tester during
// the map-legibility check — design-intent.md's "prove the map reads" gate.
// Diverse by road class, so the test covers a motorway interchange and an
// ordinary crossroads rather than six copies of the same kind of junction.
// Scans in node-index order and stops once enough distinct class-signatures
// are found — deterministic, no randomness (spec pillar 4).

/**
 * @param g          a graph as returned by scripts/lib/road-graph.mjs's loadGraph()
 * @param count      how many candidates to return
 * @param minDegree  the same junction threshold junctionNode() uses — excludes
 *                   cul-de-sacs and mid-block nodes, so every candidate is a
 *                   real decision point
 * @returns [{ node, lon, lat, classes }] — classes is the sorted, deduplicated
 *          set of road class names touching this junction
 */
export function pickCandidates(g, { count = 6, minDegree = 3 } = {}) {
  const bySignature = new Map();
  for (let node = 0; node < g.n; node++) {
    const degree = g.off[node + 1] - g.off[node];
    if (degree < minDegree) continue;
    const classIds = new Set();
    for (let k = g.off[node]; k < g.off[node + 1]; k++) classIds.add(g.cls[g.via[k]]);
    const sortedIds = [...classIds].sort((a, b) => a - b);
    const signature = sortedIds.join(',');
    if (!bySignature.has(signature)) {
      bySignature.set(signature, {
        node,
        lon: g.xy[2 * node],
        lat: g.xy[2 * node + 1],
        classes: sortedIds.map((c) => g.meta.classes[c]),
      });
    }
    if (bySignature.size >= count) break;
  }
  return [...bySignature.values()];
}
