//
// Picks a small, deterministic set of real junctions to show a tester during
// the map-legibility check — design-intent.md's "prove the map reads" gate.
// Diverse by road class, so the test covers a motorway interchange and an
// ordinary crossroads rather than six copies of the same kind of junction.
// Scans the WHOLE graph in node-index order — no early stop at `count` — so
// the separation and motorway-preference requirements below can actually be
// satisfied by whatever the graph contains, not just whatever happens to
// appear in the first few thousand nodes. Deterministic, no randomness
// (spec pillar 4).

// The same colour/width buckets blind-map/style.js's CLASS_COLOUR/CLASS_WIDTH
// match expressions use. A junction where every branch maps to the same
// bucket renders pixel-identical regardless of its raw OSM subtype, so
// diversity has to be judged on this mapped set, not the raw class names.
const LINK_PARENT = {
  motorway_link: 'motorway',
  trunk_link: 'trunk',
  primary_link: 'primary',
  secondary_link: 'secondary',
  tertiary_link: 'tertiary',
};
const NAMED_BUCKETS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

/** Maps a raw OSM highway class to the style's render bucket: one of
 * motorway/trunk/primary/secondary/tertiary, or "minor" for everything else
 * (unclassified, residential, living_street, ...). A `_link` variant maps to
 * its parent class's bucket, since the style doesn't distinguish e.g.
 * motorway from motorway_link either. */
function styleBucket(rawClass) {
  const base = LINK_PARENT[rawClass] || rawClass;
  return NAMED_BUCKETS.has(base) ? base : 'minor';
}

/** Sorted, deduplicated raw class names touching this node, read off its
 * incident edges via the CSR adjacency built by loadGraph(). */
function classesAt(g, node) {
  const ids = new Set();
  for (let k = g.off[node]; k < g.off[node + 1]; k++) ids.add(g.cls[g.via[k]]);
  return [...ids].sort((a, b) => a - b).map((id) => g.meta.classes[id]);
}

/** Equirectangular-approximation distance in km — the same convention
 * legacy/atlas/atlas-gl.js uses for its own km readout: cos(latitude) *
 * 111.32 km per degree of longitude, 111 km per degree of latitude (no
 * cosine needed there). Good enough at these separations; no need for
 * great-circle precision to reject "same suburb" candidates. */
function distanceKm(lon1, lat1, lon2, lat2) {
  const midLatRad = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lon2 - lon1) * Math.cos(midLatRad) * 111.32;
  const dy = (lat2 - lat1) * 111;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * @param g               a graph as returned by scripts/lib/road-graph.mjs's loadGraph()
 * @param count           how many candidates to return
 * @param minDegree       the same junction threshold junctionNode() uses — excludes
 *                        cul-de-sacs and mid-block nodes, so every candidate is a
 *                        real decision point
 * @param minSeparationKm reject a candidate within this many km of any
 *                        already-accepted candidate, so the set has real
 *                        geographic spread rather than clustering in one city
 * @returns [{ node, lon, lat, classes }] — classes is the sorted, deduplicated
 *          set of RAW road class names touching this junction (accurate,
 *          real data — diversity itself is judged on the mapped style
 *          bucket, not this raw set)
 */
export function pickCandidates(g, { count = 6, minDegree = 3, minSeparationKm = 20 } = {}) {
  const accepted = [];
  const seenSignatures = new Set();
  // Candidates that qualify (degree, diversity, distinct signature) and touch
  // a motorway/trunk edge, but weren't taken into `accepted` because it was
  // already full by the time they were found — a fallback pool so a
  // motorway/trunk-touching junction can still be preferred at the end.
  const majorFallbacks = [];

  for (let node = 0; node < g.n; node++) {
    const degree = g.off[node + 1] - g.off[node];
    if (degree < minDegree) continue;

    const classes = classesAt(g, node);
    const mapped = new Set(classes.map(styleBucket));
    // A junction where every branch renders in the same colour/width bucket
    // can't test "rank the branches by apparent significance" — nothing to
    // distinguish them by.
    if (mapped.size < 2) continue;

    const signature = [...mapped].sort().join(',');
    if (seenSignatures.has(signature)) continue;

    const lon = g.xy[2 * node];
    const lat = g.xy[2 * node + 1];
    const touchesMajor = mapped.has('motorway') || mapped.has('trunk');
    const candidate = { node, lon, lat, classes };

    if (accepted.length < count) {
      if (accepted.some((c) => distanceKm(c.lon, c.lat, lon, lat) < minSeparationKm)) continue;
      accepted.push(candidate);
      seenSignatures.add(signature);
    } else if (touchesMajor) {
      majorFallbacks.push(candidate);
    }
  }

  const hasMajor = accepted.some((c) => {
    const b = new Set(c.classes.map(styleBucket));
    return b.has('motorway') || b.has('trunk');
  });
  if (!hasMajor) {
    const extra = majorFallbacks.find((c) =>
      accepted.every((a) => distanceKm(a.lon, a.lat, c.lon, c.lat) >= minSeparationKm));
    if (extra) accepted.push(extra);
  }

  return accepted;
}
